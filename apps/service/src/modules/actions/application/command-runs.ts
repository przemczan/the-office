import { Injectable, Logger } from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { BusyWork } from "../../busy-work/index.js";
import {
  failedRun,
  runName,
  shortCommit,
  succeededRun,
  type ActionRun,
} from "../domain/action-run.js";
import { ActionRunRefused } from "../domain/action-run-refused.js";
import {
  commandsGone,
  couldNotRun,
  deviceLetGoOf,
  exitCodeWords,
  ranOutOfTime,
} from "../domain/action-run-words.js";
import {
  ActionDevices,
  type ActionDevice,
  type ActionDeviceHoldDisconnected,
} from "../ports/action-devices.js";
import {
  ActionProjects,
  type CommandRunSettings,
  type RunProject,
} from "../ports/action-projects.js";
import {
  CommandRunEnvironments,
  type RunInEnvironment,
} from "../ports/command-run-environments.js";
import { ActionRunLogs, type LineMask } from "./action-run-logs.js";
import { ActionRunRecords } from "./action-run-records.js";
import { RunsInBackground } from "./runs-in-background.js";

/** How a command run's commands ended, whichever runner ran them. */
interface CommandsEnd {
  /** The command it ended on, by its name. */
  readonly name: string;
  readonly exitCode: number | undefined;
  readonly endedBy?: "timeout" | "stop" | "could-not-run";
}

/** The Project device a command run holds, and the tab that relays it over USB. */
export interface CommandRunDevice extends ActionDevice {
  readonly relayTab: string | undefined;
}

/** A run going on here: its abort, and the device it holds, if any. */
interface GoingRun {
  readonly run: ActionRun;
  readonly controller: AbortController;
  readonly device: CommandRunDevice | undefined;
  /** Its hold's id once the device is held, until the run lets go of it. */
  holdId?: string | undefined;
}

/**
 * A Project command run, in the background (spec §2.15, "Where a run runs"): its own checkout of
 * the commit, then its commands before it and the command, with the Project's environment and what
 * The Office sets, in its own compose project with the Run environment On, else on the workstation;
 * how it ended last in its log; its checkout removed however it ended. A stop aborts it: the stop
 * has written the row and the log, and the run leaves them as they are.
 */
@Injectable()
export class CommandRuns {
  private readonly logger = new Logger(CommandRuns.name);
  /** Each run going on here, aborted as it stops. */
  private readonly going = new Map<string, GoingRun>();

  constructor(
    private readonly projects: ActionProjects,
    private readonly environments: CommandRunEnvironments,
    private readonly records: ActionRunRecords,
    private readonly logs: ActionRunLogs,
    private readonly schedule: Schedule,
    private readonly background: RunsInBackground,
    private readonly busyWork: BusyWork,
    private readonly devices: ActionDevices,
  ) {}

  /**
   * Runs it in the background; the row is Running already. A scheduled Office update waits for it,
   * as for a Script Stage (spec §5.1.2). A run given a device holds it in its compose project
   * before its first command and lets go of it as it ends.
   */
  begin(run: ActionRun, project: RunProject, device?: CommandRunDevice): void {
    const controller = new AbortController();
    this.going.set(run.id, { run, controller, device });
    const endBusyWork = this.busyWork.begin({
      kind: "action-run",
      label: `The Action ${run.actionName} on ${project.name}`,
    });
    this.background.start(`The Action run ${run.id} didn't run.`, () =>
      this.ran(run, project, device, controller.signal).finally(() => {
        this.going.delete(run.id);
        endBusyWork();
      }),
    );
  }

  /**
   * Ends what the run does: aborted when it goes on here, its compose project taken down, and its
   * checkout removed as it ends; else, as after a restart, what it left is removed now.
   */
  async halt(runId: string): Promise<void> {
    const going = this.going.get(runId);
    going?.controller.abort();
    // Its compose project, if it has one, is taken down now: what runs in it ends with it.
    await this.environments.stop(runId).catch((error: unknown) => {
      this.logger.error(`The compose project of the Action run ${runId} wasn't removed.`, error);
    });
    if (going === undefined) await this.projects.removeCheckout(runId).catch(() => undefined);
  }

  /** Whether the run goes on here: started since The Office started. */
  isGoing(runId: string): boolean {
    return this.going.has(runId);
  }

  /** The run going on here that names the Project device, held yet or not; undefined for none. */
  runNaming(projectDeviceId: string): ActionRun | undefined {
    for (const { run, device } of this.going.values()) {
      if (device?.id === projectDeviceId) return run;
    }
    return undefined;
  }

  /**
   * A run's hold was Disconnected: when something else ended it while the run held it (Run
   * environment turned Off, the tab closed, the device unplugged), the run stops Failed, naming
   * why, and what it started is removed; its own letting go changes nothing.
   */
  async holdDisconnected({ actionRunId, holdId }: ActionDeviceHoldDisconnected): Promise<void> {
    const going = this.going.get(actionRunId);
    if (going?.holdId !== holdId || going.device === undefined) return;
    const why = await this.devices.endedFromOutside(holdId);
    if (why === undefined || going.holdId !== holdId || going.controller.signal.aborted) return;
    going.holdId = undefined;
    going.controller.abort();
    await this.fail(going.run, deviceLetGoOf(going.device.name, why), undefined);
    await this.halt(actionRunId);
  }

  /**
   * As The Office starts, once the rows are swept: every command run's compose project and every
   * checkout left are removed, but those of runs started since; logs stay.
   */
  async sweep(): Promise<void> {
    await this.environments.sweep();
    for (const runId of await this.projects.leftoverRunIds()) {
      if (this.going.has(runId)) continue;
      await this.projects.removeCheckout(runId).catch((error: unknown) => {
        this.logger.error(`The checkout of the Action run ${runId} wasn't removed.`, error);
      });
    }
  }

  private async ran(
    run: ActionRun,
    project: RunProject,
    device: CommandRunDevice | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    let mask: LineMask | undefined;
    try {
      const settings = await this.projects.commandRunOf(run.projectId, run.actionKey);
      mask = settings.mask;
      if (settings.missingCommands.length > 0) {
        await this.fail(run, commandsGone(settings.missingCommands), mask);
        return;
      }
      await this.logs.note(
        run.id,
        `Checking out ${run.branch} at ${shortCommit(run.startCommit)}.`,
        mask,
      );
      const checkout = await this.projects.checkOut(
        run.projectId,
        run.id,
        run.branch,
        run.startCommit,
      );
      if (signal.aborted) return;
      const end = project.runEnvironmentOn
        ? await this.inEnvironment(run, checkout, settings, device, signal)
        : await this.onWorkstation(run, settings, signal);
      if (signal.aborted || end.endedBy === "stop") return;
      await this.ended(run, end, settings);
    } catch (error) {
      if (signal.aborted) return;
      const because =
        error instanceof ActionRunRefused
          ? error.message
          : `The run couldn't go on: ${error instanceof Error ? error.message : String(error)}`;
      if (!(error instanceof ActionRunRefused)) {
        this.logger.error(`The Action run ${run.id} failed.`, error);
      }
      await this.fail(run, because, mask);
    } finally {
      await this.projects.removeCheckout(run.id).catch((error: unknown) => {
        this.logger.error(`The checkout of the Action run ${run.id} wasn't removed.`, error);
      });
    }
  }

  private async inEnvironment(
    run: ActionRun,
    checkout: string,
    settings: CommandRunSettings,
    device: CommandRunDevice | undefined,
    signal: AbortSignal,
  ): Promise<CommandsEnd> {
    const office = officeVariables(run);
    const names = new Set(office.map(({ name }) => name));
    return this.environments.run({
      runId: run.id,
      projectId: run.projectId,
      checkout,
      commands: settings.commands,
      environment: {
        set: [
          ...settings.environment.set
            .filter(({ name }) => !names.has(name))
            .map(({ name, value }) => ({ name, value })),
          ...office,
        ],
        unset: settings.environment.unset,
        prependPath: settings.environment.prependPath,
      },
      installCommand: settings.install.installCommand,
      installInputs: settings.install.installInputs,
      installVariables: settings.install.installVariables,
      logFile: this.projects.logFileOf(run.id),
      mask: settings.mask,
      timeoutMs: settings.timeoutMs,
      signal,
      ...(device === undefined
        ? {}
        : {
            withDeviceHelper: true,
            onEnvironment: (environment) => this.held(run, device, environment, settings),
          }),
    });
  }

  /**
   * Holds the run's device in its compose project, before its first command (spec §5.5, "An
   * Action run's checkout"): its variables for every command, let go of as the run ends. Not
   * held, the run fails in Devices' words, nothing run.
   */
  private async held(
    run: ActionRun,
    device: CommandRunDevice,
    environment: Parameters<NonNullable<RunInEnvironment["onEnvironment"]>>[0],
    settings: CommandRunSettings,
  ): Promise<{ variables: readonly { name: string; value: string }[]; release(): Promise<void> }> {
    await this.logs.note(run.id, `Holding ${device.name}.`, settings.mask);
    const hold = await this.devices.hold({
      projectId: run.projectId,
      projectDeviceId: device.id,
      actionRunId: run.id,
      holderName: runName(run),
      startedBy: run.startedBy,
      environment,
      relayTab: device.relayTab,
      signal: environment.signal,
    });
    if (!hold.held) throw new ActionRunRefused([hold.problem]);
    const { holdId } = hold;
    const going = this.going.get(run.id);
    if (going !== undefined) going.holdId = holdId;
    return {
      variables: hold.variables,
      release: async () => {
        // Forgotten first: its own letting go isn't an end from outside.
        if (going?.holdId === holdId) going.holdId = undefined;
        await this.devices.letGo(holdId);
      },
    };
  }

  private async onWorkstation(
    run: ActionRun,
    settings: CommandRunSettings,
    signal: AbortSignal,
  ): Promise<CommandsEnd> {
    const { name, outcome, exitCode } = await this.projects.runOnWorkstation({
      runId: run.id,
      projectId: run.projectId,
      commands: settings.commands,
      variables: officeVariables(run),
      timeoutMs: settings.timeoutMs,
      signal,
    });
    switch (outcome) {
      case "passed":
        return { name, exitCode: 0 };
      case "failed":
        return { name, exitCode };
      case "timed-out":
        return { name, exitCode, endedBy: "timeout" };
      case "stopped":
        return { name, exitCode, endedBy: "stop" };
      case "could-not-run":
        return { name, exitCode, endedBy: "could-not-run" };
    }
  }

  private async ended(
    run: ActionRun,
    end: CommandsEnd,
    settings: CommandRunSettings,
  ): Promise<void> {
    const at = this.schedule.now();
    if (end.endedBy === undefined && end.exitCode === 0) {
      // The line first: a reader stops following the log once the run has ended.
      await this.logs.note(run.id, "Succeeded.");
      await this.records.change(run.id, (kept) => succeededRun(kept, at));
      return;
    }
    const last = settings.commands[settings.commands.length - 1];
    const because =
      end.endedBy === "timeout"
        ? ranOutOfTime(Math.round(settings.timeoutMs / 60_000))
        : end.exitCode === undefined
          ? couldNotRun(end.name)
          : exitCodeWords(end.name, end.exitCode, end.name === last?.name);
    await this.fail(run, because, settings.mask, end.exitCode);
  }

  private async fail(
    run: ActionRun,
    because: string,
    mask: LineMask | undefined,
    exitCode?: number,
  ): Promise<void> {
    const at = this.schedule.now();
    // The line first: a reader stops following the log once the run has ended.
    await this.logs.note(run.id, `Failed: ${because}`, mask);
    await this.records.change(run.id, (kept) =>
      failedRun(kept, because, at, exitCode === undefined ? {} : { exitCode }),
    );
  }
}

/** What The Office sets in a Project command run (spec §2.15, "What The Office sets"). */
function officeVariables(run: ActionRun): { name: string; value: string }[] {
  return [
    { name: "OFFICE_ACTION", value: run.actionKey },
    { name: "OFFICE_ACTION_BRANCH", value: run.branch },
    { name: "OFFICE_ACTION_COMMIT", value: run.startCommit },
  ];
}

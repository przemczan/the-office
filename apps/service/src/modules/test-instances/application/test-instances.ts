import { randomUUID } from "node:crypto";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule, type Wait } from "../../../platform/schedule/schedule.js";
import { HostedServices, RunEnvironmentRefused } from "../../run-environments/index.js";
import { InitiativeStateChanged } from "../../work/index.js";
import {
  BY_RESTART,
  BY_USER,
  INITIATIVE_NOT_ACTIVE,
  noInitiativeBranch,
  notHosted,
  RESTARTED_WHILE_BUILDING,
  RUN_ENVIRONMENT_OFF,
  secretsWithoutValue,
  stopWords,
  type StopReason,
} from "../domain/stop-reason.js";
import {
  TestInstanceCommitRecorded,
  TestInstanceLaunched,
  type TestInstanceStateChanged,
} from "../domain/test-instance-events.js";
import { TestInstanceNotFound, TestInstanceRefused } from "../domain/test-instance-refused.js";
import {
  everyPortInUse,
  freeProxyPort,
  overTheLimit,
  type ActiveInstanceName,
} from "../domain/test-instance-settings.js";
import {
  failed,
  isActive,
  launchedInstance,
  startedRunning,
  stopped,
  withCommit,
  type LaunchedBy,
  type TestInstance,
  type TestInstanceState,
} from "../domain/test-instance.js";
import { Initiatives } from "../ports/initiatives.js";
import {
  ProjectTestTargets,
  type InstanceMask,
  type TargetEntryPoint,
  type TargetLaunch,
} from "../ports/project-test-targets.js";
import { TestInstanceRepository } from "../ports/test-instance-repository.js";
import { TestInstanceSettingsStore } from "../ports/test-instance-settings-store.js";
import { InstanceFiles } from "./instance-files.js";
import { OfficePort } from "./test-instance-limits.js";
import { RunningTestInstances } from "./running-test-instances.js";

/** A test target as the Initiative's page lists it, with its instances on the Initiative. */
export interface InitiativeTarget {
  readonly key: string;
  readonly name: string;
  readonly kind: "hosted";
  readonly entryPoint: TargetEntryPoint;
  /** Newest first. */
  readonly instances: readonly TestInstance[];
}

/** One Project where the Initiative has a branch. */
export interface InitiativeTestProject {
  readonly projectId: string;
  readonly runEnvironmentOn: boolean;
  /** The branch's tip as the Project's repository has it, unfetched; undefined with none. */
  readonly branchCommit: string | undefined;
  readonly targets: readonly InitiativeTarget[];
}

/** What launching names: the Project and its test target. */
export interface Launch {
  readonly projectId: string;
  readonly targetKey: string;
}

/** The instance's log from an offset, and its state, so a reader stops once it has ended. */
export interface InstanceLog {
  readonly text: string;
  readonly nextOffset: number;
  readonly state: TestInstanceState;
}

/** What The Office holds in memory for an instance from its launch until it ends. */
interface Held {
  /** Ends a launch still Building. */
  readonly building: AbortController;
  /** Its target's Secret variables, hidden in every line of its log. */
  readonly mask: InstanceMask;
  idleStop?: Wait;
}

/**
 * Test instances (spec §2.12): launching a Hosted test target on an Initiative's branch in its own
 * checkout and compose project, its Proxy port and the Test instances at once limit, its log, and
 * its stop by the user, by Idle time, as its Initiative ends and in the sweep as The Office starts.
 * Run environments are reached only through `HostedServices`, which takes no run environment slot.
 */
@Injectable()
export class TestInstances implements OnModuleInit {
  private readonly logger = new Logger(TestInstances.name);
  private readonly held = new Map<string, Held>();
  /** The check of the limit and the ports with the insert, one launch at a time. */
  private launching: Promise<unknown> = Promise.resolve();
  /** The work going on in the background, which a test waits for. */
  private readonly background = new Set<Promise<void>>();

  constructor(
    private readonly repository: TestInstanceRepository,
    private readonly settings: TestInstanceSettingsStore,
    private readonly initiatives: Initiatives,
    private readonly targets: ProjectTestTargets,
    private readonly hostedServices: HostedServices,
    private readonly running: RunningTestInstances,
    private readonly files: InstanceFiles,
    private readonly schedule: Schedule,
    private readonly events: EventBus,
    private readonly officePort: OfficePort,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(InitiativeStateChanged, ({ initiativeId, to }) => {
      if (to !== "done" && to !== "dropped") return;
      // In the background: the bus waits for its handlers, and the state change for nothing.
      this.inBackground(
        `The test instances of the Initiative ${initiativeId} were not stopped.`,
        () => this.stopEachOf(initiativeId, { kind: "initiative-ended", state: to }),
      );
    });
  }

  /** A group per Project where the Initiative has a branch, each with its Hosted test targets. */
  async listFor(initiativeId: string): Promise<InitiativeTestProject[]> {
    const initiative = await this.initiatives.find(initiativeId);
    if (!initiative) throw TestInstanceNotFound.initiative(initiativeId);
    const instances = await this.repository.listOf(initiativeId);
    return Promise.all(
      initiative.branches.map(async ({ projectId, branch }) => {
        const [targets, runEnvironmentOn, branchCommit] = await Promise.all([
          this.targets.targetsOf(projectId),
          this.targets.runEnvironmentOn(projectId),
          this.targets.branchCommitOf(projectId, branch),
        ]);
        return {
          projectId,
          runEnvironmentOn,
          branchCommit,
          targets: targets.flatMap(({ key, name, kind, entryPoint }) =>
            kind === "hosted"
              ? [
                  {
                    key,
                    name,
                    kind,
                    entryPoint,
                    instances: instances.filter(
                      (instance) => instance.projectId === projectId && instance.targetKey === key,
                    ),
                  },
                ]
              : [],
          ),
        };
      }),
    );
  }

  async read(id: string): Promise<TestInstance> {
    const instance = await this.repository.find(id);
    if (!instance) throw TestInstanceNotFound.instance(id);
    return instance;
  }

  /**
   * Launches the target on the Initiative's branch: refused, with every reason, unless the
   * Initiative is active with a branch in the Project, the target is Hosted with its Secret
   * variables typed, the Project's Run environment is On, the limit has room and a Proxy port is
   * free. Answers the instance Building at once; the checkout and the start go on in the
   * background, ending Running or Failed.
   */
  async launch(initiativeId: string, launch: Launch, by: LaunchedBy): Promise<TestInstance> {
    const initiative = await this.initiatives.find(initiativeId);
    if (!initiative) throw TestInstanceNotFound.initiative(initiativeId);
    if (initiative.state !== "active") throw new TestInstanceRefused([INITIATIVE_NOT_ACTIVE]);
    const branch = initiative.branches.find(({ projectId }) => projectId === launch.projectId);
    if (!branch) throw new TestInstanceRefused([noInitiativeBranch(launch.projectId)]);
    const target = await this.targets.launchOf(launch.projectId, launch.targetKey);
    if (target.kind !== "hosted" || target.containerPort === undefined) {
      throw new TestInstanceRefused([notHosted(target.name)]);
    }
    const problems = [
      ...(target.runEnvironmentOn ? [] : [RUN_ENVIRONMENT_OFF]),
      ...(target.secretsWithoutValue.length === 0
        ? []
        : [secretsWithoutValue(target.secretsWithoutValue)]),
    ];
    if (problems.length > 0) throw new TestInstanceRefused(problems);

    const { instance, idleMinutes } = await this.oneAtATime(async () => {
      const settings = await this.settings.read();
      const active = await this.repository.active();
      const over = overTheLimit(await this.namesOf(active), settings.testInstancesAtOnce);
      if (over !== undefined) throw new TestInstanceRefused([over]);
      // The Office's own port is never given out, should OFFICE_PORT fall inside the range.
      const held = new Set([
        this.officePort.port,
        ...active.flatMap(({ port }) => (port === undefined ? [] : [port])),
      ]);
      const port = freeProxyPort(settings, held);
      if (port === undefined) throw new TestInstanceRefused([everyPortInUse(settings)]);
      const made = launchedInstance({
        id: randomUUID(),
        initiativeId,
        projectId: launch.projectId,
        targetKey: target.key,
        targetName: target.name,
        port,
        launchedBy: by,
        at: this.schedule.now(),
      });
      await this.repository.add(made);
      return { instance: made, idleMinutes: settings.idleMinutes };
    });
    const held: Held = { building: new AbortController(), mask: target.mask };
    this.held.set(instance.id, held);
    await this.events.publish(
      new TestInstanceLaunched(instance.id, initiativeId, instance.port ?? 0),
    );
    this.inBackground(`The Test instance ${instance.id} didn't launch.`, () =>
      this.build(instance, branch.branch, target, held, idleMinutes),
    );
    return instance;
  }

  /**
   * Stops a Building or Running instance: Stopped, its port freed, its containers, volumes and
   * checkout removed, the reason last in its log. One that has ended already stays as it is.
   */
  async stop(id: string, reason: StopReason = BY_USER): Promise<TestInstance> {
    const instance = await this.read(id);
    if (!isActive(instance)) return instance;
    const held = this.held.get(id);
    held?.building.abort();
    const change = await this.repository.update(id, (kept) => stopped(kept, this.schedule.now()));
    if (!change?.event) return this.read(id);
    await this.files.note(id, stopWords(reason), held?.mask);
    await this.ended(change.instance, change.event);
    return change.instance;
  }

  /** The instance's masked log from byte `from` on. */
  async readLog(id: string, from: number): Promise<InstanceLog> {
    const instance = await this.read(id);
    const { text, nextOffset } = await this.files.read(id, from);
    return { text, nextOffset, state: instance.state };
  }

  /**
   * As The Office starts (from office.ts, never a module's start): every instance left Running
   * ends Stopped and every one left Building Failed, saying The Office restarted; then the
   * runtime's Hosted instances and the checkouts left are removed. Logs stay.
   */
  async sweep(): Promise<void> {
    const at = this.schedule.now();
    for (const instance of await this.repository.active()) {
      const building = instance.state === "building";
      const change = await this.repository.update(instance.id, (kept) =>
        building ? failed(kept, RESTARTED_WHILE_BUILDING, at) : stopped(kept, at),
      );
      if (!change?.event) continue;
      await this.files.note(
        instance.id,
        building ? RESTARTED_WHILE_BUILDING : stopWords(BY_RESTART),
      );
      await this.events.publish(change.event);
    }
    await this.hostedServices.sweep();
    for (const checkout of await this.files.leftCheckouts()) {
      await this.targets.removeCheckout(checkout);
    }
  }

  /** Waits for the launches and stops going on in the background, for a test. */
  async settled(): Promise<void> {
    while (this.background.size > 0) await Promise.all(this.background);
  }

  /** The checkout, the entry point's check and the start, ending Running or Failed. */
  private async build(
    instance: TestInstance,
    branch: string,
    target: TargetLaunch,
    held: Held,
    idleMinutes: number,
  ): Promise<void> {
    const { id, projectId } = instance;
    const signal = held.building.signal;
    const checkout = this.files.checkoutOf(id);
    try {
      await this.files.note(id, `Fetching ${branch}.`, held.mask);
      const { commit } = await this.targets.checkOut(projectId, branch, checkout);
      if (signal.aborted) {
        await this.targets.removeCheckout(checkout);
        return;
      }
      await this.files.note(id, `Checked out ${branch} at ${commit}.`, held.mask);
      const recorded = await this.repository.update(id, (kept) => withCommit(kept, commit));
      if (recorded) {
        await this.events.publish(
          new TestInstanceCommitRecorded(id, instance.initiativeId, commit),
        );
      }
      const problems = await this.targets.entryPointProblemsAt(projectId, commit, target.key);
      if (problems.length > 0) throw new TestInstanceRefused(problems);
      const install = await this.targets.installSettingsOf(projectId);
      const { hostPort } = await this.hostedServices.start(
        {
          instanceId: id,
          projectId,
          checkout,
          entryPoint: target.entryPoint,
          containerPort: target.containerPort ?? 0,
          variables: target.variables.map(({ name, value }) => ({ name, value })),
          installCommand: install.installCommand,
          installInputs: install.installInputs,
          installVariables: install.installVariables,
          logFile: this.files.logOf(id),
          mask: held.mask,
          signal,
        },
        (reason) =>
          this.inBackground(`The Test instance ${id} that ended wasn't marked Failed.`, () =>
            this.fail(id, reason),
          ),
      );
      const change = await this.repository.update(id, (kept) =>
        startedRunning(kept, this.schedule.now()),
      );
      if (!change?.event) {
        // Stopped or Failed while it started: what it started goes.
        await this.hostedServices.stop(id);
        return;
      }
      this.running.add({
        id,
        port: instance.port ?? 0,
        hostPort,
        appPort: target.containerPort ?? 0,
      });
      this.armIdleStop(id, held, idleMinutes);
      await this.events.publish(change.event);
    } catch (error) {
      if (signal.aborted) return;
      await this.fail(id, reasonOf(error));
    }
  }

  /** Building or Running → Failed, saying why in its log too, and what it holds removed. */
  private async fail(id: string, reason: string): Promise<void> {
    const change = await this.repository.update(id, (kept) =>
      failed(kept, reason, this.schedule.now()),
    );
    if (!change?.event) return;
    await this.files.note(id, `Failed: ${reason}`, this.held.get(id)?.mask);
    await this.ended(change.instance, change.event);
  }

  /** It ended: told, then its containers, volumes and checkout removed. */
  private async ended(instance: TestInstance, event: TestInstanceStateChanged): Promise<void> {
    const held = this.held.get(instance.id);
    held?.idleStop?.cancel();
    this.held.delete(instance.id);
    this.running.remove(instance.id);
    await this.events.publish(event);
    await this.hostedServices.stop(instance.id).catch((error: unknown) => {
      this.logger.warn(`The Test instance ${instance.id} wasn't removed.`, error);
    });
    await this.targets.removeCheckout(this.files.checkoutOf(instance.id));
  }

  /**
   * Stops the instance once it has gone the Idle time with no request; a request meanwhile moves
   * the stop on when it is due, so activity costs no timer.
   */
  private armIdleStop(id: string, held: Held, minutes: number): void {
    const idleMs = minutes * 60_000;
    const arm = (at: number): void => {
      held.idleStop = this.schedule.once(`test-instance-idle-${id}`, new Date(at), async () => {
        const last = this.running.lastActivityOf(id);
        if (last === undefined) return;
        if (last + idleMs > this.schedule.now().getTime()) {
          arm(last + idleMs);
          return;
        }
        await this.stop(id, { kind: "idle", minutes });
      });
    };
    arm(this.schedule.now().getTime() + idleMs);
  }

  private async stopEachOf(initiativeId: string, reason: StopReason): Promise<void> {
    for (const instance of await this.repository.listOf(initiativeId)) {
      if (isActive(instance)) await this.stop(instance.id, reason);
    }
  }

  /** Each instance by its target's name and its Initiative's, as the limit's refusal names them. */
  private async namesOf(active: readonly TestInstance[]): Promise<ActiveInstanceName[]> {
    return Promise.all(
      active.map(async ({ targetName, initiativeId }) => ({
        targetName,
        initiativeName: (await this.initiatives.find(initiativeId))?.name ?? "an Initiative",
      })),
    );
  }

  private oneAtATime<Result>(step: () => Promise<Result>): Promise<Result> {
    const next = this.launching.then(step, step);
    this.launching = next.catch(() => undefined);
    return next;
  }

  private inBackground(failure: string, work: () => Promise<void>): void {
    const running = work()
      .catch((error: unknown) => {
        this.logger.error(failure, error);
      })
      .finally(() => this.background.delete(running));
    this.background.add(running);
  }
}

/** A start's failure in the user's words. */
function reasonOf(error: unknown): string {
  if (error instanceof TestInstanceRefused || error instanceof RunEnvironmentRefused) {
    return error.reasons.join(" ");
  }
  return error instanceof Error ? error.message : String(error);
}

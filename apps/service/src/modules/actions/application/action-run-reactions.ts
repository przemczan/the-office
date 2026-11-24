import { Injectable, type OnModuleInit } from "@nestjs/common";
import { ActionProjects } from "../ports/action-projects.js";
import { ActionRunSignals } from "../ports/action-run-signals.js";
import { ActionRuns } from "./action-runs.js";
import { RunsInBackground } from "./runs-in-background.js";

/**
 * What stops or removes runs from outside (spec §2.15, "When a run stops", "Defining Actions"):
 * the fire alarm sounded ASAP stops every running command run, "Stopped by the fire alarm."; the
 * Project's Actions switched off stops its running command runs; an Action removed has its runs
 * removed with their logs, a running one stopped first. Each in the background, since the bus
 * waits for its handlers.
 */
@Injectable()
export class ActionRunReactions implements OnModuleInit {
  constructor(
    private readonly signals: ActionRunSignals,
    private readonly runs: ActionRuns,
    private readonly projects: ActionProjects,
    private readonly background: RunsInBackground,
  ) {}

  onModuleInit(): void {
    this.signals.onAlarmSoundedAsap(() => {
      this.background.start("The command runs weren't stopped for the fire alarm.", () =>
        this.runs.stopEachCommandRun({ kind: "fire-alarm" }),
      );
    });
    this.signals.onActionsSwitchedOff((projectId) => {
      this.background.start(
        `The command runs of the Project ${projectId} weren't stopped.`,
        async () => {
          const { name } = await this.projects.projectOf(projectId);
          await this.runs.stopEachCommandRun({ kind: "actions-off", projectName: name }, projectId);
        },
      );
    });
    this.signals.onActionsRemoved((projectId, keys) => {
      this.background.start(
        `The runs of the removed Actions of ${projectId} weren't removed.`,
        () => this.runs.removeRunsOf(projectId, keys),
      );
    });
  }
}

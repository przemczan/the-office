import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { isRunning, runsPastTheKept, type ActionRun } from "../domain/action-run.js";
import {
  ActionRunChanged,
  ActionRunStarted,
  ActionRunStateChanged,
  ActionRunsRemoved,
} from "../domain/action-run-events.js";
import { ActionProjects } from "../ports/action-projects.js";
import { ActionRunRepository, type ActionRunChange } from "../ports/action-run-repository.js";
import { ActionRunLogs } from "./action-run-logs.js";

/**
 * The runs' rows with the events each change carries, saved first and published after: a start,
 * a state change, any other change the History shows; and the newest 20 of each Action kept, an
 * older one removed with its log as a newer one ends (spec §2.15, "Action runs kept").
 */
@Injectable()
export class ActionRunRecords {
  private readonly logger = new Logger(ActionRunRecords.name);

  constructor(
    private readonly repository: ActionRunRepository,
    private readonly logs: ActionRunLogs,
    private readonly projects: ActionProjects,
    private readonly events: EventBus,
  ) {}

  async started(run: ActionRun): Promise<void> {
    await this.events.publish(
      new ActionRunStarted(
        run.id,
        run.projectId,
        run.actionKey,
        run.actionName,
        run.status.kind,
        run.branch,
        run.startedBy,
      ),
    );
  }

  /** Applies the change and announces it; answers the run changed, or undefined for no change. */
  async change(id: string, change: ActionRunChange): Promise<ActionRun | undefined> {
    const changed = await this.repository.update(id, change);
    if (changed === undefined) return undefined;
    await this.announce(changed.before, changed.after);
    return changed.after;
  }

  /** Announces a change already saved, such as a run that failed as it was added. */
  async announce(before: ActionRun, after: ActionRun): Promise<void> {
    const { status: from } = before;
    const { status: to } = after;
    if (from.state !== to.state || before.outcome !== after.outcome) {
      await this.events.publish(
        new ActionRunStateChanged(
          after.id,
          after.projectId,
          after.actionKey,
          after.actionName,
          after.status.kind,
          after.branch,
          from.state,
          to.state,
          after.outcome,
          after.endedBecause,
          after.stoppedBy,
        ),
      );
    } else {
      await this.events.publish(new ActionRunChanged(after.id, after.projectId, after.actionKey));
    }
    if (isRunning(before) && !isRunning(after)) {
      await this.keepTheNewest(after.projectId, after.actionKey);
    }
  }

  /** Removes the runs past the newest 20 of the Action that have ended, with their logs. */
  async keepTheNewest(projectId: string, actionKey: string): Promise<void> {
    const past = runsPastTheKept(await this.repository.listOfAction(projectId, actionKey));
    await this.remove(projectId, actionKey, past);
  }

  /** Removes the runs with their logs and checkouts, and announces it. */
  async remove(projectId: string, actionKey: string, runs: readonly ActionRun[]): Promise<void> {
    if (runs.length === 0) return;
    const ids = runs.map(({ id }) => id);
    await this.repository.remove(ids);
    for (const id of ids) {
      await this.logs.remove(id).catch((error: unknown) => {
        this.logger.error(`The log of the Action run ${id} wasn't removed.`, error);
      });
      await this.projects.removeCheckout(id).catch(() => undefined);
    }
    await this.events.publish(new ActionRunsRemoved(projectId, actionKey, ids));
  }
}

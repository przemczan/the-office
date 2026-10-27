import { Module } from "@nestjs/common";
import { OfficeToolRegistry } from "../../engine/index.js";
import type { FiveHourWindow, OfficeTask, OpenDecision, StageOfTask } from "../domain/now.js";
import { AccountUsage } from "./account-usage.js";
import { DeskLimit } from "./desk-limit.js";
import { OfficeStatusCards } from "./office-status-cards.js";
import { OfficeTasks } from "./office-tasks.js";
import { OpenDecisions } from "./open-decisions.js";
import { TaskStageProgress } from "./task-stage-progress.js";

const STARTED_STATES: readonly string[] = ["in-progress", "waiting-on-you", "paused"];

export class OfficeTasksForTests extends OfficeTasks {
  tasks: OfficeTask[] = [];

  async list(): Promise<readonly OfficeTask[]> {
    return this.tasks;
  }

  async listStarted(): Promise<readonly OfficeTask[]> {
    return this.tasks.filter(({ state }) => STARTED_STATES.includes(state));
  }

  /** Every Task's person, by the Task's id. */
  readonly people = new Map<string, string>();

  async read(taskId: string): Promise<{ readonly personRole: string | undefined }> {
    return { personRole: this.people.get(taskId) };
  }
}

export class OpenDecisionsForTests extends OpenDecisions {
  open: OpenDecision[] = [];

  async listOpen(): Promise<readonly OpenDecision[]> {
    return this.open;
  }
}

export class TaskStageProgressForTests extends TaskStageProgress {
  readonly stages = new Map<string, StageOfTask[]>();

  async progress(taskId: string): Promise<{ readonly stages: readonly StageOfTask[] } | undefined> {
    const stages = this.stages.get(taskId);
    return stages && { stages };
  }
}

export class DeskLimitForTests extends DeskLimit {
  limit = 3;

  async officeWideLimit(): Promise<number> {
    return this.limit;
  }
}

export class AccountUsageForTests extends AccountUsage {
  current: { readonly fiveHour: FiveHourWindow } | undefined = undefined;
}

/** Keeps the sessions an Office status card was posted in. */
export class OfficeStatusCardsForTests extends OfficeStatusCards {
  readonly postedIn: string[] = [];

  async postOfficeStatus(sessionId: string): Promise<void> {
    this.postedIn.push(sessionId);
  }
}

const PORTS = [
  OfficeTasksForTests,
  OpenDecisionsForTests,
  TaskStageProgressForTests,
  DeskLimitForTests,
  AccountUsageForTests,
  OfficeStatusCardsForTests,
  OfficeToolRegistry,
];

/**
 * Provides them all, and an Office tool registry of the test's own, for
 * `NotificationsModule.register({ imports: [this module] })`.
 */
@Module({ providers: PORTS, exports: PORTS })
export class NotificationsPortsForTestsModule {}

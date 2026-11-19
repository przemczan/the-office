import { Module } from "@nestjs/common";
import { OfficeToolRegistry } from "../../engine/index.js";
import type {
  EngineUsageWindows,
  InitiativeTask,
  NowFireAlarm,
  OfficeInitiative,
  OfficeTask,
  OpenDecision,
  QueuedOnNow,
  StageOfTask,
  StandInChoiceWaiting,
  TaskResume,
} from "../domain/now.js";
import { AccountUsage } from "./account-usage.js";
import { DeskLimit } from "./desk-limit.js";
import { KnownPeople } from "./known-people.js";
import { OfficeFireAlarm } from "./office-fire-alarm.js";
import { OfficeInitiatives } from "./office-initiatives.js";
import { OfficeStatusCards } from "./office-status-cards.js";
import { OfficeTasks } from "./office-tasks.js";
import { OpenDecisions } from "./open-decisions.js";
import { ResumePlans } from "./resume-plans.js";
import { StandInChoicesWaiting } from "./stand-in-choices-waiting.js";
import { StartQueue } from "./start-queue.js";
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

export class OfficeInitiativesForTests extends OfficeInitiatives {
  initiatives: OfficeInitiative[] = [];
  /** Each Initiative's Tasks, by its id. */
  readonly tasks = new Map<string, InitiativeTask[]>();

  async list(): Promise<readonly OfficeInitiative[]> {
    return this.initiatives;
  }

  async tasksByInitiative(): Promise<ReadonlyMap<string, readonly InitiativeTask[]>> {
    return this.tasks;
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

export class StartQueueForTests extends StartQueue {
  queued: QueuedOnNow[] = [];

  async list(): Promise<readonly QueuedOnNow[]> {
    return this.queued;
  }
}

export class KnownPeopleForTests extends KnownPeople {
  /** The holders of duties, by duty key: none until a test sets one. */
  readonly holders = new Map<string, string>();

  async holderOf(duty: string): Promise<string | undefined> {
    return this.holders.get(duty);
  }
}

export class AccountUsageForTests extends AccountUsage {
  readonly readingsByEngine = new Map<string, Omit<EngineUsageWindows, "engineId">>();
}

/** Keeps the sessions an Office status card was posted in. */
export class OfficeStatusCardsForTests extends OfficeStatusCards {
  readonly postedIn: string[] = [];

  async postOfficeStatus(sessionId: string): Promise<void> {
    this.postedIn.push(sessionId);
  }
}

export class OfficeFireAlarmForTests extends OfficeFireAlarm {
  alarm: NowFireAlarm = { on: false };

  async read(): Promise<NowFireAlarm> {
    return this.alarm;
  }
}

/** How each Task resumes, by its id, as a test sets it; undefined, as stopping, unless set. */
export class ResumePlansForTests extends ResumePlans {
  readonly resumes = new Map<string, TaskResume>();

  async of(taskId: string): Promise<TaskResume | undefined> {
    return this.resumes.get(taskId);
  }
}

/** The Stages waiting for the choice of a Stand-in Engine, as a test sets them; none unless set. */
export class StandInChoicesWaitingForTests extends StandInChoicesWaiting {
  choices: StandInChoiceWaiting[] = [];

  async waiting(): Promise<readonly StandInChoiceWaiting[]> {
    return this.choices;
  }
}

const PORTS = [
  OfficeTasksForTests,
  OfficeInitiativesForTests,
  OpenDecisionsForTests,
  TaskStageProgressForTests,
  DeskLimitForTests,
  StartQueueForTests,
  KnownPeopleForTests,
  AccountUsageForTests,
  OfficeStatusCardsForTests,
  OfficeFireAlarmForTests,
  ResumePlansForTests,
  StandInChoicesWaitingForTests,
  OfficeToolRegistry,
];

/**
 * Provides them all, and an Office tool registry of the test's own, for
 * `NotificationsModule.register({ imports: [this module] })`.
 */
@Module({ providers: PORTS, exports: PORTS })
export class NotificationsPortsForTestsModule {}

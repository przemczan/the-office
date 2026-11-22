import { Module } from "@nestjs/common";
import { OfficeToolRegistry } from "../../engine/index.js";
import type {
  EngineUsageWindows,
  InitiativeTask,
  NowFireAlarm,
  OfficeInitiative,
  OfficeTask,
  OfficeUpdateFound,
  OpenDecision,
  OpenProposal,
  PullRequestNeedingAttention,
  QueuedOnNow,
  ShapingReply,
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
import { OfficeUpdateAvailable } from "./office-update-available.js";
import { OpenDecisions } from "./open-decisions.js";
import { OpenProposals } from "./open-proposals.js";
import { PullRequestsWaiting } from "./pull-requests-waiting.js";
import { ResumePlans } from "./resume-plans.js";
import { ShapingReplies } from "./shaping-replies.js";
import { SkillUpdatesFound } from "./skill-updates-found.js";
import { StandInChoicesWaiting } from "./stand-in-choices-waiting.js";
import { StartQueue } from "./start-queue.js";
import { TaskStageProgress } from "./task-stage-progress.js";

const STARTED_STATES: readonly string[] = ["in-progress", "waiting-on-you", "paused"];

export class OfficeTasksForTests extends OfficeTasks {
  tasks: OfficeTask[] = [];

  async findAll(ids: readonly string[]): Promise<readonly OfficeTask[]> {
    return this.tasks.filter(({ id }) => ids.includes(id));
  }

  async started(): Promise<readonly OfficeTask[]> {
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

/** The open Proposals, as a test sets them; none unless set. */
export class OpenProposalsForTests extends OpenProposals {
  open: OpenProposal[] = [];

  async waitingOnTheUser(): Promise<readonly OpenProposal[]> {
    return this.open;
  }
}

/** The pull requests needing attention, as a test sets them; none unless set. */
export class PullRequestsWaitingForTests extends PullRequestsWaiting {
  pullRequests: PullRequestNeedingAttention[] = [];

  async needingAttention(): Promise<readonly PullRequestNeedingAttention[]> {
    return this.pullRequests;
  }
}

/** The Skills with an update, by name, as a test sets them; none unless set. */
export class SkillUpdatesFoundForTests extends SkillUpdatesFound {
  names: string[] = [];

  async withUpdate(): Promise<readonly string[]> {
    return this.names;
  }
}

/** The Office update found, as a test sets it; none unless set. */
export class OfficeUpdateAvailableForTests extends OfficeUpdateAvailable {
  found: OfficeUpdateFound | undefined;

  async available(): Promise<OfficeUpdateFound | undefined> {
    return this.found;
  }
}

/** The shapers' answers waiting on the user's reply, as a test sets them; none unless set. */
export class ShapingRepliesForTests extends ShapingReplies {
  replies: ShapingReply[] = [];
  /** The Initiatives each read asked about, in order. */
  readonly asked: (readonly string[])[] = [];

  async waitingForReply(initiativeIds: readonly string[]): Promise<readonly ShapingReply[]> {
    this.asked.push(initiativeIds);
    return this.replies.filter(({ initiativeId }) => initiativeIds.includes(initiativeId));
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
  OpenProposalsForTests,
  PullRequestsWaitingForTests,
  SkillUpdatesFoundForTests,
  OfficeUpdateAvailableForTests,
  ShapingRepliesForTests,
  OfficeToolRegistry,
];

/**
 * Provides them all, and an Office tool registry of the test's own, for
 * `NotificationsModule.register({ imports: [this module] })`.
 */
@Module({ providers: PORTS, exports: PORTS })
export class NotificationsPortsForTestsModule {}

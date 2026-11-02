import { join } from "node:path";
import { Injectable, Module } from "@nestjs/common";
import {
  FireAlarmInThreads,
  InitiativeThreadSetups,
  ProposalAppliers,
  TaskThreadSetups,
  WorkRecords,
} from "../../conversations/index.js";
import { FIRST_CLAUDE_CODE_ENGINE, type EngineId, type EngineModel } from "../../engine/index.js";
import type { NewProject } from "../../projects/index.js";
import type { AccountWindowsReading } from "../domain/cap-waits.js";
import { FIRE_ALARM_OFF, type FireAlarm } from "../domain/fire-alarm.js";
import { DEFAULT_OFFICE_WIDE_LIMIT, type TaskLimit } from "../domain/task-start.js";
import {
  countedTokens,
  type StageTokens,
  type StageUsages,
  type WindowRatios,
} from "../domain/usage-estimate.js";
import { DEFAULT_USAGE_SETTINGS, type UsageSettings } from "../domain/usage-settings.js";
import { AccountWindowRatios } from "./account-window-ratios.js";
import { AccountWindows } from "./account-windows.js";
import { DayUsage, type ModelDayUsage } from "./day-usage.js";
import { FireAlarmRepository } from "./fire-alarm-repository.js";
import { IdeaCards } from "./idea-cards.js";
import { InitiativeThreads, type InitiativeThreadOpening } from "./initiative-threads.js";
import { KnownPeople, type KnownPerson } from "./known-people.js";
import { KnownProjects, type KnownProject } from "./known-projects.js";
import { NewProjects, type AddedProject } from "./new-projects.js";
import { ProjectWorktrees, type TaskWorktree } from "./project-worktrees.js";
import { ProposalDrafts, type WorkProposedChange } from "./proposal-drafts.js";
import { SessionPeople } from "./session-people.js";
import { SessionInitiatives } from "./session-initiatives.js";
import { SessionTasks } from "./session-tasks.js";
import { TaskDecisions } from "./task-decisions.js";
import { TaskThreads, type TaskThreadOpening } from "./task-threads.js";
import { TaskTokens, type EngineIdTokens } from "./task-tokens.js";
import { UsageHistory } from "./usage-history.js";
import { ModelPrices } from "./model-prices.js";
import { WorkSettings } from "./work-settings.js";

/** The one Project id KnownProjectsForTests doesn't know. */
export const UNKNOWN_PROJECT = "no-such-project";

/** Knows every Project but UNKNOWN_PROJECT, each with Quick fix as its default Pipeline. */
@Injectable()
export class KnownProjectsForTests extends KnownProjects {
  async find(id: string): Promise<KnownProject | undefined> {
    if (id === UNKNOWN_PROJECT) return undefined;
    return {
      id,
      name: `The ${id}`,
      baseBranch: "main",
      defaultPipeline: "quick-fix",
      commands: { install: "npm install", build: "", lint: "npm run lint", test: "npm test" },
      useProjectSkills: true,
    };
  }
}

/**
 * Adds every Project it is given, keyed by its name, and refuses none; a Repository URL is cloned
 * into `/repositories/` and its last path segment.
 */
@Injectable()
export class NewProjectsForTests extends NewProjects {
  readonly added: string[] = [];
  private readonly byPath = new Map<string, AddedProject>();

  clonePathOf(url: string): string {
    return `/repositories/${url.split("/").at(-1) ?? ""}`;
  }

  async newProjectProblems(): Promise<string[]> {
    return [];
  }

  async findByPath(path: string): Promise<AddedProject | undefined> {
    return this.byPath.get(path);
  }

  async add({ name, path }: Pick<NewProject, "name" | "path">): Promise<AddedProject> {
    this.added.push(name);
    const project = { id: name.toLowerCase().replaceAll(" ", "-"), name };
    this.byPath.set(path, project);
    return project;
  }
}

/** Each Task's worktree is under `/worktrees`; `opened` lists those made, as `projectId/taskId`. */
@Injectable()
export class ProjectWorktreesForTests extends ProjectWorktrees {
  readonly opened: string[] = [];
  /** Set to make opening a worktree fail with it. */
  failure: Error | undefined;
  /** Where every Project's worktrees are; a test sets a real folder to put files in them. */
  folder = "/worktrees";

  async open(projectId: string, taskId: string): Promise<TaskWorktree> {
    if (this.failure) throw this.failure;
    this.opened.push(`${projectId}/${taskId}`);
    return this.find(projectId, taskId);
  }

  async find(projectId: string, taskId: string): Promise<TaskWorktree> {
    return {
      path: join(this.folder, projectId, taskId),
      branch: `office/${taskId}`,
      environment: { PROJECT: projectId },
      screenshotsFolder: ".office/screenshots",
    };
  }
}

/**
 * Every Role is filled but those in `vacant`, by a person named after it ("The developer") whose
 * Task limit is in `taskLimits`, else 3.
 */
@Injectable()
export class KnownPeopleForTests extends KnownPeople {
  readonly vacant = new Set<string>();
  readonly taskLimits = new Map<string, TaskLimit>();

  async find(roleKey: string): Promise<KnownPerson | undefined> {
    if (this.vacant.has(roleKey)) return undefined;
    return {
      roleKey,
      card: {
        name: `The ${roleKey}`,
        taskLimit: this.taskLimits.get(roleKey) ?? 3,
        engine: "agent-sdk",
        model: "claude-haiku-5-5",
      },
    };
  }
}

/**
 * Office settings of the test's own, for a test that changes them: every test file shares the
 * database, whose row each Start reads.
 */
export class WorkSettingsForTests extends WorkSettings {
  private limit = DEFAULT_OFFICE_WIDE_LIMIT;

  async officeWideLimit(): Promise<number> {
    return this.limit;
  }

  async changeOfficeWideLimit(officeWideLimit: number): Promise<void> {
    this.limit = officeWideLimit;
  }

  private usage: UsageSettings = DEFAULT_USAGE_SETTINGS;

  async usageSettings(): Promise<UsageSettings> {
    return this.usage;
  }

  async changeUsageSettings(settings: UsageSettings): Promise<void> {
    this.usage = settings;
  }
}

/**
 * A fire alarm of the test's own: every test file shares the database, whose row each Start and
 * release reads, so a test that sounds it must never sound the stored one.
 */
export class FireAlarmRepositoryForTests extends FireAlarmRepository {
  private alarm: FireAlarm = FIRE_ALARM_OFF;

  async read(): Promise<FireAlarm> {
    return this.alarm;
  }

  async sound(since: Date): Promise<boolean> {
    if (this.alarm.on) return false;
    this.alarm = { on: true, since };
    return true;
  }

  async allClear(): Promise<boolean> {
    if (!this.alarm.on) return false;
    this.alarm = FIRE_ALARM_OFF;
    return true;
  }

  /** Off again without the all clear, leaving the Tasks it paused as they are; for a test's end. */
  turnOff(): void {
    this.alarm = FIRE_ALARM_OFF;
  }
}

/** Each session is the Planner's, but UNKNOWN_SESSION. */
@Injectable()
export class SessionPeopleForTests extends SessionPeople {
  async personInSession(sessionId: string): Promise<string | undefined> {
    return sessionId === UNKNOWN_SESSION ? undefined : "planner";
  }
}

export const UNKNOWN_SESSION = "no-such-session";

/** Keeps each Idea card posted, by the session it was posted in. */
@Injectable()
export class IdeaCardsForTests extends IdeaCards {
  readonly posted: { readonly sessionId: string; readonly ideaId: string }[] = [];

  async postIdeaCard(sessionId: string, ideaId: string): Promise<void> {
    this.posted.push({ sessionId, ideaId });
  }
}

/** Each session is on the Task a test puts it on, and on none otherwise, as a chat's is. */
@Injectable()
export class SessionTasksForTests extends SessionTasks {
  readonly tasks = new Map<string, string>();

  async taskInSession(sessionId: string): Promise<string | undefined> {
    return this.tasks.get(sessionId);
  }
}

/** Each session is on the Initiative a test puts it on, and on none otherwise. */
@Injectable()
export class SessionInitiativesForTests extends SessionInitiatives {
  readonly initiatives = new Map<string, string>();

  async initiativeInSession(sessionId: string): Promise<string | undefined> {
    return this.initiatives.get(sessionId);
  }
}

/** Keeps each Thread opened on a Task, without a session; or fails, once `failure` is set. */
@Injectable()
export class TaskThreadsForTests extends TaskThreads {
  readonly opened: TaskThreadOpening[] = [];
  failure: Error | undefined;

  async openOnTask(opening: TaskThreadOpening): Promise<{ readonly id: string }> {
    if (this.failure) throw this.failure;
    this.opened.push(opening);
    return { id: crypto.randomUUID() };
  }
}

/** Keeps each Thread opened on an Initiative, without a session; or fails, once `failure` is set. */
@Injectable()
export class InitiativeThreadsForTests extends InitiativeThreads {
  readonly opened: InitiativeThreadOpening[] = [];
  failure: Error | undefined;

  async startOnInitiative(opening: InitiativeThreadOpening): Promise<{ readonly id: string }> {
    if (this.failure) throw this.failure;
    this.opened.push(opening);
    return { id: crypto.randomUUID() };
  }
}

/** The Decisions open on each Task: none unless a test opens some. */
@Injectable()
export class TaskDecisionsForTests extends TaskDecisions {
  readonly open = new Map<string, number>();

  async openOn(taskId: string): Promise<number> {
    return this.open.get(taskId) ?? 0;
  }
}

/** Keeps each Proposal drafted, by the session it was drafted in. */
@Injectable()
export class ProposalDraftsForTests extends ProposalDrafts {
  readonly drafted: { readonly sessionId: string; readonly change: WorkProposedChange }[] = [];

  async draft(sessionId: string, change: WorkProposedChange): Promise<{ readonly id: string }> {
    this.drafted.push({ sessionId, change });
    return { id: crypto.randomUUID() };
  }
}

/**
 * The history of the test's own, so no test reads the Stage runs every test file shares: none
 * unless a test gives some, by the done Tasks it names.
 */
@Injectable()
export class UsageHistoryForTests extends UsageHistory {
  readonly stageUsages = new Map<string, StageUsages>();
  /** Office-wide, as the test gives it; undefined is "no cost". */
  officeDollarsPerToken: number | undefined;

  /** The usages of the first named Task a test gave some for. */
  async of(doneTaskIds: readonly string[]): Promise<StageUsages> {
    const given = doneTaskIds.find((id) => this.stageUsages.has(id));
    return (given === undefined ? undefined : this.stageUsages.get(given)) ?? new Map();
  }

  async dollarsPerToken(): Promise<number | undefined> {
    return this.officeDollarsPerToken;
  }
}

/** Every model the test prices costs its dollars per counted token; the rest have no price. */
@Injectable()
export class ModelPricesForTests extends ModelPrices {
  readonly dollarsPerToken = new Map<string, number>();

  async costOf({ model }: EngineModel, tokens: StageTokens): Promise<number | undefined> {
    const price = this.dollarsPerToken.get(model);
    return price === undefined ? undefined : price * countedTokens(tokens);
  }
}

/**
 * The windows of the test's own, so no test weighs a reading another file's session made: none
 * unless a test gives one, which counts for the first Claude Code engine's account.
 */
@Injectable()
export class AccountWindowsForTests extends AccountWindows {
  reading: AccountWindowsReading | undefined;

  of(engineId: EngineId): AccountWindowsReading | undefined {
    return engineId === FIRST_CLAUDE_CODE_ENGINE.id ? this.reading : undefined;
  }
}

/**
 * The window ratios of the test's own, so no test pools the pairs every other file's sessions'
 * readings keep: none unless a test gives some, which count for every engine id with windows.
 */
@Injectable()
export class AccountWindowRatiosForTests extends AccountWindowRatios {
  windowRatios: WindowRatios = { fiveHour: undefined, sevenDay: undefined };

  async ratios(): Promise<WindowRatios> {
    return this.windowRatios;
  }
}

/**
 * The day's use of the test's own, so no test weighs the turns every other file's sessions add to
 * today's: none unless a test gives some, by engine id.
 */
@Injectable()
export class DayUsageForTests extends DayUsage {
  readonly usage = new Map<EngineId, readonly ModelDayUsage[]>();

  async today(engineId: EngineId): Promise<readonly ModelDayUsage[]> {
    return this.usage.get(engineId) ?? [];
  }
}

/** Each Task's Stage Threads' tokens as the test gives them: none unless it gives some. */
@Injectable()
export class TaskTokensForTests extends TaskTokens {
  readonly stageTokens = new Map<string, readonly EngineIdTokens[]>();

  async stageTokensSoFar(taskId: string): Promise<readonly EngineIdTokens[]> {
    return this.stageTokens.get(taskId) ?? [];
  }
}

const PORTS = [
  UsageHistoryForTests,
  ModelPricesForTests,
  AccountWindowsForTests,
  AccountWindowRatiosForTests,
  DayUsageForTests,
  TaskTokensForTests,
  KnownProjectsForTests,
  NewProjectsForTests,
  ProjectWorktreesForTests,
  KnownPeopleForTests,
  SessionPeopleForTests,
  IdeaCardsForTests,
  SessionTasksForTests,
  SessionInitiativesForTests,
  TaskThreadsForTests,
  InitiativeThreadsForTests,
  TaskDecisionsForTests,
  ProposalDraftsForTests,
  TaskThreadSetups,
  InitiativeThreadSetups,
  WorkRecords,
  ProposalAppliers,
  FireAlarmInThreads,
];

/** Provides them all, for `WorkModule.register({ imports: [this module] })`. */
@Module({ providers: PORTS, exports: PORTS })
export class WorkPortsForTestsModule {}

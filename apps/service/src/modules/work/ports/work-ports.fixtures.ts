import type { AttachmentOwner } from "../domain/attachment.js";
import { join } from "node:path";
import { Injectable, Module } from "@nestjs/common";
import {
  FireAlarmInThreads,
  InitiativeThreadSetups,
  MessageImages,
  ProposalAppliers,
  TaskThreadSetups,
  WorkRecords,
} from "../../conversations/index.js";
import {
  EngineModels,
  EngineModule,
  FIRST_CLAUDE_CODE_ENGINE,
  type EngineId,
  type EngineModel,
} from "../../engine/index.js";
import { DUTIES, MemoryTaskTitles } from "../../people/index.js";
import {
  FeatureSwitchedOff,
  IssueTasks,
  IssueWriteBack,
  ProjectFeatures,
  TaskBases,
  TestTargetsSetUpTasks,
  type ProjectFeature,
  type IssueDropReason,
  type NewProject,
  type TaskBaseLookup,
} from "../../projects/index.js";
import type { UserRef } from "../domain/author.js";
import type { AccountWindowsReading, UsedUpWindowReading } from "../domain/cap-waits.js";
import {
  FIRE_ALARM_OFF,
  soundingOf,
  type FireAlarm,
  type FireAlarmSounding,
  type FireAlarmWay,
} from "../domain/fire-alarm.js";
import type { AllStageResults, DecisionWaitingOnTheUser } from "../domain/record-words.js";
import type { TaskKind } from "../domain/task.js";
import { DEFAULT_ARCHIVE_PERIOD } from "../domain/task-archive.js";
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
import {
  InitiativeThreads,
  type InitiativeThreadOpening,
  type InitiativeThreadWaiting,
} from "./initiative-threads.js";
import {
  KnownEngineCascade,
  type EngineCascadePlace,
  type EngineInCascade,
  type StandInsApplying,
} from "./known-engine-cascade.js";
import { KnownPeople, type KnownPerson } from "./known-people.js";
import {
  KnownProjects,
  type KnownProject,
  type KnownProjectCommand,
  type KnownPublishingMode,
} from "./known-projects.js";
import { NewProjects, type AddedProject } from "./new-projects.js";
import {
  ProjectBranchDeletions,
  type BranchDeletion,
  type BranchDeletionPreview,
  type BranchDeletionRequest,
  type BranchOwner,
} from "./project-branch-deletions.js";
import {
  ProjectInitiativeBranches,
  type InitiativeBranchMaking,
  type InitiativeBranchRemoval,
} from "./project-initiative-branches.js";
import {
  ProjectWorktrees,
  type TaskBranchCheckout,
  type TaskWorktree,
} from "./project-worktrees.js";
import { TaskPullRequests, type TaskPullRequest } from "./task-pull-requests.js";
import { StageResults, type TaskStageResults, type TaskStageRunsOutline } from "./stage-results.js";
import { TaskGates } from "./task-gates.js";
import { ProposalDrafts, type WorkProposedChange } from "./proposal-drafts.js";
import { SessionPeople } from "./session-people.js";
import { SessionInitiatives, type SessionInitiativeThread } from "./session-initiatives.js";
import { SessionTasks } from "./session-tasks.js";
import type { OpenTaskDecision } from "../domain/initiative-planning.js";
import { TaskDecisions } from "./task-decisions.js";
import {
  TaskThreads,
  type PersonsTaskThread,
  type TaskThreadTitle,
  type TaskThreadOpening,
  type TaskThreadStarting,
} from "./task-threads.js";
import { TaskTokens, type EngineIdTokens } from "./task-tokens.js";
import { ThreadTurns } from "./thread-turns.js";
import { UsageHistory } from "./usage-history.js";
import { ModelPrices } from "./model-prices.js";
import { WorkSettings } from "./work-settings.js";

/** The one Project id KnownProjectsForTests doesn't know. */
export const UNKNOWN_PROJECT = "no-such-project";

/**
 * Knows every Project but UNKNOWN_PROJECT, each with Quick fix as its default Pipeline and a
 * Project limit as high as the Office-wide limit's maximum, so only the other limits hold a Start.
 */
@Injectable()
export class KnownProjectsForTests extends KnownProjects {
  /** A Project's commands a test gives it, by the Project's id; any other has build, lint and test. */
  readonly commands = new Map<string, readonly KnownProjectCommand[]>();
  /** A Project's publishing mode a test gives it; any other merges. */
  readonly publishingModes = new Map<string, KnownPublishingMode>();

  async find(id: string): Promise<KnownProject | undefined> {
    if (id === UNKNOWN_PROJECT) return undefined;
    return {
      id,
      name: `The ${id}`,
      baseBranch: "main",
      defaultPipeline: "quick-fix",
      installCommand: "npm install",
      commands: this.commands.get(id) ?? [
        { key: "build", name: "Build", commandLine: "" },
        { key: "lint", name: "Lint", commandLine: "npm run lint" },
        { key: "test", name: "Test", commandLine: "npm test" },
      ],
      useProjectSkills: true,
      projectSkillsOff: [],
      projectLimit: 12,
      publishingMode: this.publishingModes.get(id) ?? "merge",
    };
  }

  /** A Kind's default Pipeline a test gives a Project, by the Project's id and the Kind. */
  readonly kindDefaultPipelines = new Map<string, Partial<Record<TaskKind, string>>>();

  async defaultPipelineFor(projectId: string, kind: TaskKind): Promise<string | undefined> {
    const project = await this.find(projectId);
    return project && (this.kindDefaultPipelines.get(projectId)?.[kind] ?? project.defaultPipeline);
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

/**
 * Branches as a set of `projectId/branch` the repository knows, each judged safe at the commit
 * `tip-of-<branch>` here and on origin unless a test sets its judgement; `judged` and `deleted`
 * list what was asked, in order.
 */
@Injectable()
export class ProjectBranchDeletionsForTests extends ProjectBranchDeletions {
  /** The Projects whose setting Delete branches once merged is On. */
  readonly on = new Set<string>();
  readonly known = new Set<string>();
  /** What a test says a branch's judgement differs in, by `projectId/branch`. */
  readonly judgements = new Map<string, Partial<BranchDeletionPreview>>();
  readonly judged: { readonly key: string; readonly owner: BranchOwner }[] = [];
  readonly deleted: string[] = [];

  async deletesMergedBranches(projectId: string): Promise<boolean> {
    return this.on.has(projectId);
  }

  async projectsDeletingMergedBranches(): Promise<readonly string[]> {
    return [...this.on];
  }

  async knownBranches(projectId: string): Promise<readonly string[]> {
    return [...this.known]
      .filter((key) => key.startsWith(`${projectId}/`))
      .map((key) => key.slice(projectId.length + 1));
  }

  async isKnown(projectId: string, branch: string): Promise<boolean> {
    return this.known.has(`${projectId}/${branch}`);
  }

  async judge(
    projectId: string,
    branch: string,
    owner: BranchOwner,
  ): Promise<BranchDeletionPreview> {
    const key = `${projectId}/${branch}`;
    this.judged.push({ key, owner });
    const commit = `tip-of-${branch}`;
    return {
      branch,
      baseBranch: "main",
      copies: [
        { kind: "local", name: branch, commit },
        { kind: "remote", name: `origin/${branch}`, commit },
      ],
      worktreePath: null,
      holdsWork: null,
      refusal: null,
      ...this.judgements.get(key),
    };
  }

  async delete(
    projectId: string,
    branch: string,
    owner: BranchOwner,
    request: BranchDeletionRequest,
  ): Promise<BranchDeletion> {
    const preview = await this.judge(projectId, branch, owner);
    if (preview.refusal !== null) return { kind: "refused", reason: preview.refusal };
    const moved = preview.copies.some(
      (copy) =>
        !request.expected.some(({ kind, commit }) => kind === copy.kind && commit === copy.commit),
    );
    if (moved) {
      return { kind: "refused", reason: "The branch changed since it was checked; check again." };
    }
    if (preview.holdsWork !== null && !request.deleteUnmerged) {
      return { kind: "refused", reason: `The branch ${branch} holds work the base lacks.` };
    }
    const key = `${projectId}/${branch}`;
    this.known.delete(key);
    this.deleted.push(key);
    return {
      kind: "deleted",
      copies: preview.copies,
      ...(preview.worktreePath === null ? {} : { worktreePath: preview.worktreePath }),
    };
  }
}

/**
 * The Initiative's branches as a set of `projectId/branch`, each made at a commit of its own;
 * `made` and `removed` list them in order. A Project in `refusing` refuses with its reason, and
 * one in `failingRemoval` fails to remove its branch, as git does when it was moved meanwhile.
 */
@Injectable()
export class ProjectInitiativeBranchesForTests extends ProjectInitiativeBranches {
  readonly made: string[] = [];
  readonly removed: string[] = [];
  /** Branches there already, as `projectId/branch`, as a test sets them. */
  readonly existing = new Set<string>();
  readonly refusing = new Map<string, string>();
  readonly failingRemoval = new Set<string>();

  async make(projectId: string, branch: string): Promise<InitiativeBranchMaking> {
    const reason = this.refusing.get(projectId);
    if (reason !== undefined) return { kind: "refused", reason };
    const key = `${projectId}/${branch}`;
    if (this.existing.has(key)) {
      return { kind: "refused", reason: `The branch ${branch} exists in ${projectId} already.` };
    }
    this.existing.add(key);
    this.made.push(key);
    return { kind: "made", commit: `commit-of-${key}` };
  }

  async remove(projectId: string, branch: string): Promise<void> {
    if (this.failingRemoval.has(projectId)) {
      throw new Error(`cannot lock ref 'refs/heads/${branch}' in ${projectId}`);
    }
    const key = `${projectId}/${branch}`;
    this.existing.delete(key);
    this.removed.push(key);
  }

  async exists(projectId: string, branch: string): Promise<boolean> {
    return this.existing.has(`${projectId}/${branch}`);
  }

  /** Projects whose Initiative's branch a test says holds nothing unpublished; any other does. */
  readonly published = new Set<string>();
  /** Each `holdsUnpublished` asked, as `projectId/branch` and the Publishing Task's id, if any. */
  readonly unpublishedAsked: string[] = [];

  async holdsUnpublished(
    projectId: string,
    branch: string,
    publishedByTaskId?: string,
  ): Promise<boolean> {
    this.unpublishedAsked.push(
      `${projectId}/${branch}${publishedByTaskId ? ` after ${publishedByTaskId}` : ""}`,
    );
    return !this.published.has(projectId);
  }

  /** Projects whose Initiative's branch a test says holds commits its base lacks. */
  readonly holdingCommits = new Set<string>();

  async removeEmpty(projectId: string, branch: string): Promise<InitiativeBranchRemoval> {
    if (this.holdingCommits.has(projectId)) {
      return {
        kind: "refused",
        reason: `The branch ${branch} in ${projectId} holds commits main doesn't have, so it stays.`,
      };
    }
    const key = `${projectId}/${branch}`;
    this.existing.delete(key);
    this.removed.push(key);
    return { kind: "removed" };
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
  /** What each Task's commits changed, as a test sets it. */
  readonly changes = new Map<string, string>();
  /** Set to make reading the changes fail with it, as with no worktree on disk. */
  changesFailure: Error | undefined;

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

  /** A worktree is there once it was opened. */
  async exists(projectId: string, taskId: string): Promise<boolean> {
    return this.opened.includes(`${projectId}/${taskId}`);
  }

  async changesSoFar(_projectId: string, taskId: string): Promise<string | undefined> {
    if (this.changesFailure) throw this.changesFailure;
    return this.changes.get(taskId);
  }

  /** Where each Task's branch is checked out, as a test sets it; nowhere for any other Task. */
  readonly checkouts = new Map<string, TaskBranchCheckout>();

  async checkoutOfBranch(_projectId: string, taskId: string): Promise<TaskBranchCheckout> {
    return (
      this.checkouts.get(taskId) ?? {
        branch: `office/${taskId}`,
        checkedOutIn: undefined,
        inTasksOwnWorktree: false,
      }
    );
  }
}

/** Each Task's open pull request, as a test sets it; none for any other Task. */
@Injectable()
export class TaskPullRequestsForTests extends TaskPullRequests {
  readonly open = new Map<string, TaskPullRequest>();

  async openOf(taskId: string): Promise<TaskPullRequest | undefined> {
    return this.open.get(taskId);
  }
}

/** Each Task's Stage results, as a test sets them; none for any other Task. */
@Injectable()
export class StageResultsForTests extends StageResults {
  readonly results = new Map<string, TaskStageResults>();

  async of(taskId: string, roleKey: string): Promise<TaskStageResults> {
    return this.results.get(`${taskId}/${roleKey}`) ?? { lines: [], handoverNotes: [] };
  }

  /** Each Task's whole Stage results, as a test sets them; none for any other Task. */
  readonly allResults = new Map<string, AllStageResults>();

  async ofTask(taskId: string): Promise<AllStageResults> {
    return this.allResults.get(taskId) ?? { lines: [], handoverNotes: [] };
  }

  /** Each Task's Stages and runs, as a test sets them; none made and no run for any other Task. */
  readonly outlines = new Map<string, Omit<TaskStageRunsOutline, "taskId">>();

  async outlinesOf(taskIds: readonly string[]): Promise<readonly TaskStageRunsOutline[]> {
    return taskIds.map((taskId) => ({
      taskId,
      ...(this.outlines.get(taskId) ?? { stages: undefined, runs: [] }),
    }));
  }
}

/** When each Task's last acted-on Gate run ended, as a test sets it; none for any other Task. */
@Injectable()
export class TaskGatesForTests extends TaskGates {
  readonly lastActedOnGateEnds = new Map<string, Date>();

  async lastActedOnGateEnd(taskId: string): Promise<Date | undefined> {
    return this.lastActedOnGateEnds.get(taskId);
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
      },
    };
  }

  /**
   * The Role holding each duty, by duty key: its default Role (the CTO shapes Initiatives, the
   * Planner plans) until a test moves it with `hold`, to another Role or to nobody.
   */
  private readonly holders = new Map<string, string | undefined>(
    DUTIES.map((duty) => [duty.key, duty.defaultRoleKey]),
  );

  /** `duty` goes to the Role keyed `roleKey`, or to nobody. */
  hold(duty: string, roleKey: string | undefined): void {
    this.holders.set(duty, roleKey);
  }

  /** As People answers: the holder only while their Role is filled. */
  async holderOf(duty: string): Promise<string | undefined> {
    const holder = this.holders.get(duty);
    return holder === undefined || this.vacant.has(holder) ? undefined : holder;
  }

  async dutyHolders(): Promise<ReadonlyMap<string, string>> {
    return new Map(
      [...this.holders].flatMap(([duty, holder]) =>
        holder === undefined || this.vacant.has(holder) ? [] : [[duty, holder] as const],
      ),
    );
  }
}

/**
 * Every Role runs on the first Claude Code engine on Haiku, unless `onTask` gives the engine and
 * model of the Task's engine override (its own, or its Initiative's with `level` "initiative"),
 * with no Stand-in Engines, or `inProject` the Project's own; the Stand-in Engine list that applies
 * elsewhere is the Project's own in `ownStandIns`, else the Office's, as Engine's settings list it.
 */
@Injectable()
export class KnownEngineCascadeForTests extends KnownEngineCascade {
  readonly inProject = new Map<string, EngineModel>();
  readonly onTask = new Map<string, EngineModel & { readonly level?: "task" | "initiative" }>();
  readonly ownStandIns = new Map<string, readonly EngineId[]>();

  constructor(private readonly engineModels: EngineModels) {
    super();
  }

  async applying(
    _roleKey: string,
    { projectId, taskId }: EngineCascadePlace,
  ): Promise<EngineInCascade | null> {
    const forced = taskId === undefined ? undefined : this.onTask.get(taskId);
    if (forced) {
      const { level = "task", engineId, model } = forced;
      return { engineId, model, level, standIns: { from: "none", engineIds: [] } };
    }
    const own = this.ownStandIns.get(projectId);
    const standIns: StandInsApplying = own
      ? { from: "project", engineIds: own }
      : { from: "office", engineIds: (await this.engineModels.standIns()).standInEngines };
    const inProject = this.inProject.get(projectId);
    if (inProject) return { ...inProject, level: "project", standIns };
    return {
      engineId: FIRST_CLAUDE_CODE_ENGINE.id,
      model: "claude-haiku-5-5",
      level: "office",
      standIns,
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

  private period = DEFAULT_ARCHIVE_PERIOD;

  async archivePeriod(): Promise<number> {
    return this.period;
  }

  async changeArchivePeriod(archivePeriod: number): Promise<void> {
    this.period = archivePeriod;
  }

  private autoModeChoice = false;

  async autoMode(): Promise<boolean> {
    return this.autoModeChoice;
  }

  async changeAutoMode(autoMode: boolean): Promise<void> {
    this.autoModeChoice = autoMode;
  }

  private usage: UsageSettings = DEFAULT_USAGE_SETTINGS;

  async usageSettings(): Promise<UsageSettings> {
    return this.usage;
  }

  async changeUsageSettings(settings: UsageSettings): Promise<void> {
    this.usage = settings;
  }

  async forgetEngineCaps(engineId: EngineId): Promise<void> {
    this.usage = {
      ...this.usage,
      caps: this.usage.caps.filter((caps) => caps.engineId !== engineId),
    };
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

  async sound(since: Date, way: FireAlarmWay): Promise<FireAlarmSounding> {
    const sounding = soundingOf(this.alarm, way);
    if (sounding === "turned-on") this.alarm = { on: true, since, way };
    else if (sounding === "made-stricter" && this.alarm.on) this.alarm = { ...this.alarm, way };
    return sounding;
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
  /** The Role key of the person in each session a test names; the Planner in any other. */
  readonly people = new Map<string, string>();

  async personInSession(sessionId: string): Promise<string | undefined> {
    return sessionId === UNKNOWN_SESSION ? undefined : (this.people.get(sessionId) ?? "planner");
  }

  /** The user who asked in each session a test names; none in any other. */
  readonly askedBy = new Map<string, UserRef>();

  async askedByInSession(sessionId: string): Promise<UserRef | undefined> {
    return this.askedBy.get(sessionId);
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

  /** Where the images sent in each session's Thread are kept, as a test names; the session's Task otherwise. */
  readonly imageOwners = new Map<string, AttachmentOwner>();

  async imageOwnerInSession(sessionId: string): Promise<AttachmentOwner | undefined> {
    const taskId = this.tasks.get(sessionId);
    return this.imageOwners.get(sessionId) ?? (taskId ? { kind: "task", taskId } : undefined);
  }
}

/**
 * Each session is on the Initiative a test puts it on, and on none otherwise; in the Thread a test
 * names, or in one named after the session.
 */
@Injectable()
export class SessionInitiativesForTests extends SessionInitiatives {
  readonly initiatives = new Map<string, string>();
  readonly threads = new Map<string, string>();

  async initiativeInSession(sessionId: string): Promise<string | undefined> {
    return this.initiatives.get(sessionId);
  }

  async initiativeThreadInSession(sessionId: string): Promise<SessionInitiativeThread | undefined> {
    const initiativeId = this.initiatives.get(sessionId);
    if (initiativeId === undefined) return undefined;
    return { initiativeId, threadId: this.threads.get(sessionId) ?? sessionId };
  }
}

/** A Thread The Office asked the person to start again in, and on what. */
export interface AskedAgain {
  readonly threadId: string;
  readonly opening: string;
}

/**
 * Keeps each Thread opened on a Task, waiting for the user, and each started with an opening,
 * without a session; or fails, once `failure` is set. The persons' Threads a test sets in
 * `personsThreads` are known by id, and each asked again is kept, but those in `failingAskAgain`.
 * A person's Thread titles are those a test sets in `titles`, by their Role's key.
 */
@Injectable()
export class TaskThreadsForTests extends TaskThreads {
  readonly opened: TaskThreadOpening[] = [];
  readonly started: TaskThreadStarting[] = [];
  readonly personsThreads = new Map<string, PersonsTaskThread>();
  readonly askedAgain: AskedAgain[] = [];
  readonly failingAskAgain = new Set<string>();
  readonly titles = new Map<string, readonly TaskThreadTitle[]>();
  failure: Error | undefined;

  async titlesOnTasksWith(roleKey: string): Promise<readonly TaskThreadTitle[]> {
    return this.titles.get(roleKey) ?? [];
  }

  async personsThreadOnTask(threadId: string): Promise<PersonsTaskThread | undefined> {
    return this.personsThreads.get(threadId);
  }

  async askAgain(threadId: string, opening: string): Promise<{ readonly id: string }> {
    if (this.failingAskAgain.has(threadId)) throw new Error(`Thread ${threadId} can't answer.`);
    this.askedAgain.push({ threadId, opening });
    return { id: threadId };
  }

  async openOnTask(opening: TaskThreadOpening): Promise<{ readonly id: string }> {
    if (this.failure) throw this.failure;
    this.opened.push(opening);
    return { id: crypto.randomUUID() };
  }

  async startOnTask(starting: TaskThreadStarting): Promise<{ readonly id: string }> {
    if (this.failure) throw this.failure;
    this.started.push(starting);
    return { id: crypto.randomUUID() };
  }
}

/**
 * Keeps each Thread opened on an Initiative, without a session: those started at once in `opened`,
 * those waiting for the user in `waiting`, either by id in `byId`; and each asked again. Or fails,
 * once `failure` is set.
 */
@Injectable()
export class InitiativeThreadsForTests extends InitiativeThreads {
  readonly opened: InitiativeThreadOpening[] = [];
  readonly waiting: InitiativeThreadWaiting[] = [];
  readonly byId = new Map<string, InitiativeThreadWaiting>();
  readonly askedAgain: AskedAgain[] = [];
  failure: Error | undefined;

  async openOnInitiative(waiting: InitiativeThreadWaiting): Promise<{ readonly id: string }> {
    if (this.failure) throw this.failure;
    this.waiting.push(waiting);
    return this.kept(waiting);
  }

  async idsOnInitiativeWith(initiativeId: string, roleKey: string): Promise<readonly string[]> {
    return [...this.byId]
      .filter(([, thread]) => thread.initiativeId === initiativeId && thread.roleKey === roleKey)
      .map(([id]) => id);
  }

  private kept(thread: InitiativeThreadWaiting): { readonly id: string } {
    const id = thread.threadId ?? crypto.randomUUID();
    this.byId.set(id, thread);
    return { id };
  }

  async askAgain(threadId: string, opening: string): Promise<{ readonly id: string }> {
    if (this.failure) throw this.failure;
    this.askedAgain.push({ threadId, opening });
    return { id: threadId };
  }

  async startOnInitiative(opening: InitiativeThreadOpening): Promise<{ readonly id: string }> {
    if (this.failure) throw this.failure;
    this.opened.push(opening);
    return this.kept(opening);
  }
}

/** The Threads with a turn running: none unless a test starts one. */
@Injectable()
export class ThreadTurnsForTests extends ThreadTurns {
  readonly running = new Set<string>();

  async isTurnRunning(threadId: string): Promise<boolean> {
    return this.running.has(threadId);
  }
}

/** The Decisions open on each Task, and in each Thread: none unless a test opens some. */
@Injectable()
export class TaskDecisionsForTests extends TaskDecisions {
  readonly open = new Map<string, number>();
  readonly inThread = new Map<string, readonly OpenTaskDecision[]>();
  readonly waiting = new Map<string, readonly DecisionWaitingOnTheUser[]>();
  /** The Tasks whose open Decisions Work closed, in the order it closed them. */
  readonly closedOn: string[] = [];
  /** The ended Initiatives whose open Decisions on no Task Work closed, in that order. */
  readonly closedOnInitiatives: string[] = [];

  async openOn(taskId: string): Promise<number> {
    return this.open.get(taskId) ?? 0;
  }

  async tasksWithOpenDecisions(): Promise<readonly string[]> {
    return [...this.open].flatMap(([taskId, count]) => (count > 0 ? [taskId] : []));
  }

  async openInThread(threadId: string): Promise<readonly OpenTaskDecision[]> {
    return this.inThread.get(threadId) ?? [];
  }

  async waitingOnTheUserOn(taskId: string): Promise<readonly DecisionWaitingOnTheUser[]> {
    return this.waiting.get(taskId) ?? [];
  }

  async closeOnDroppedTask(taskId: string): Promise<void> {
    this.closedOn.push(taskId);
    this.open.delete(taskId);
    this.waiting.delete(taskId);
  }

  async closeOnInitiative(initiativeId: string): Promise<void> {
    this.closedOnInitiatives.push(initiativeId);
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
 * unless a test gives one, `reading` for the first Claude Code engine's account and `readings` for
 * any other engine id's.
 */
@Injectable()
export class AccountWindowsForTests extends AccountWindows {
  reading: AccountWindowsReading | undefined;
  readonly readings = new Map<EngineId, AccountWindowsReading>();
  /** The used-up window of each engine id a test gives, kept until the test's own clock passes it. */
  readonly usedUp = new Map<EngineId, UsedUpWindowReading>();

  of(engineId: EngineId): AccountWindowsReading | undefined {
    return engineId === FIRST_CLAUDE_CODE_ENGINE.id ? this.reading : this.readings.get(engineId);
  }

  usedUpUntil(engineId: EngineId): UsedUpWindowReading | undefined {
    return this.usedUp.get(engineId);
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

/**
 * Projects' registry of each Task's base, which Work fills as it starts, without Projects' git: a
 * test asks the lookup Work registered.
 */
@Injectable()
export class TaskBasesForTests {
  lookup: TaskBaseLookup | undefined;

  register(lookup: TaskBaseLookup): void {
    this.lookup = lookup;
  }
}

/** Projects' issue write-back, recording what Work tells it, in order. */
@Injectable()
export class IssueWriteBackForTests extends IssueWriteBack {
  readonly told: (
    | { readonly what: "started" | "done" | "reopened"; readonly taskId: string }
    | { readonly what: "dropped"; readonly taskId: string; readonly reason: IssueDropReason | null }
  )[] = [];

  async taskStarted(taskId: string): Promise<void> {
    this.told.push({ what: "started", taskId });
  }

  async taskDone(taskId: string): Promise<void> {
    this.told.push({ what: "done", taskId });
  }

  async taskDropped(taskId: string, reason: IssueDropReason | null): Promise<void> {
    this.told.push({ what: "dropped", taskId, reason });
  }

  async taskReopened(taskId: string): Promise<void> {
    this.told.push({ what: "reopened", taskId });
  }
}

/**
 * Projects' feature switches, every feature on for every Project unless a test switches it off;
 * the refusal names the Project as KnownProjectsForTests does.
 */
@Injectable()
export class ProjectFeaturesForTests {
  /** `<projectId>/<feature>` for each feature a test switched off. */
  readonly off = new Set<string>();

  async isOn(projectId: string, feature: ProjectFeature): Promise<boolean> {
    return !this.off.has(`${projectId}/${feature}`);
  }

  async ensureOn(projectId: string, feature: ProjectFeature): Promise<void> {
    if (!(await this.isOn(projectId, feature))) {
      throw new FeatureSwitchedOff(feature, `The ${projectId}`);
    }
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
  TaskPullRequestsForTests,
  ProjectInitiativeBranchesForTests,
  ProjectBranchDeletionsForTests,
  StageResultsForTests,
  TaskGatesForTests,
  KnownPeopleForTests,
  KnownEngineCascadeForTests,
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
  MessageImages,
  MemoryTaskTitles,
  ProposalAppliers,
  FireAlarmInThreads,
  TaskBasesForTests,
  { provide: TaskBases, useExisting: TaskBasesForTests },
  IssueTasks,
  TestTargetsSetUpTasks,
  IssueWriteBackForTests,
  { provide: IssueWriteBack, useExisting: IssueWriteBackForTests },
  ProjectFeaturesForTests,
  { provide: ProjectFeatures, useExisting: ProjectFeaturesForTests },
];

/** Provides them all, for `WorkModule.register({ imports: [this module] })`. */
@Module({ imports: [EngineModule], providers: PORTS, exports: PORTS })
export class WorkPortsForTestsModule {}

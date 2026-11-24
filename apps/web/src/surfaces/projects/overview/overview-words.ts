import {
  ACTIVE_TEST_INSTANCE_STATES,
  type CiRun,
  type CiRunProblem,
  type EnvironmentCheck,
  type Idea,
  type Initiative,
  type Project,
  type ProjectSettingChange,
  type ProjectTestInstances,
  type PullRequestProblem,
  type RemoteNeeds,
  type TaskSummary,
  type TestInstance,
} from "@the-office/contracts";
import {
  initiativeProgress,
  type InitiativeProgress,
} from "../../../shell/work/initiative-progress.ts";
import { commandCheckLabel, worktreeCheckLabel } from "../environment-labels.ts";
import { remoteNeedsLine } from "../remote-needs-words.ts";

/** One of the Project's Initiatives on its Overview, with how far it is across all its Tasks. */
export interface OverviewInitiative {
  readonly initiative: Initiative;
  readonly progress: InitiativeProgress;
}

/**
 * The Initiatives spanning the Project that are still going (Shaping or Active, not archived), the
 * Active first, each in the list's order.
 */
export function initiativesOfProject(
  initiatives: readonly Initiative[],
  tasks: readonly TaskSummary[],
  projectId: string,
): OverviewInitiative[] {
  const going = initiatives.filter(
    ({ state, archivedAt, projectIds }) =>
      (state === "shaping" || state === "active") &&
      archivedAt === null &&
      projectIds.includes(projectId),
  );
  return [
    ...going.filter(({ state }) => state === "active"),
    ...going.filter(({ state }) => state === "shaping"),
  ].map((initiative) => ({
    initiative,
    progress: initiativeProgress(
      tasks.filter(({ initiativeId }) => initiativeId === initiative.id),
      tasks,
    ),
  }));
}

/** The Project's New Ideas, the newest captured first. */
export function newIdeasOfProject(ideas: readonly Idea[], projectId: string): Idea[] {
  return ideas
    .filter((idea) => idea.projectId === projectId && idea.state === "new")
    .toSorted((first, second) => second.capturedAt.localeCompare(first.capturedAt));
}

/** The Project's Building and Running test instances on every branch, the newest launched first. */
export function activeTestInstances(testInstances: ProjectTestInstances): TestInstance[] {
  return testInstances.branches
    .flatMap(({ instances }) => instances)
    .filter(({ state }) => ACTIVE_TEST_INSTANCE_STATES.includes(state))
    .toSorted((first, second) => second.launchedAt.localeCompare(first.launchedAt));
}

/** The CI tile's runs: the newest on the base branch, and the newest on any branch when newer. */
export interface NewestCiRuns {
  readonly onBaseBranch: CiRun | undefined;
  /** Left out when it is the base branch's own, or older. */
  readonly newer: CiRun | undefined;
}

/** From the runs as the CI listing gives them, newest first. */
export function newestCiRuns(
  runs: readonly CiRun[],
  projectId: string,
  baseBranch: string,
): NewestCiRuns {
  const ofProject = runs.filter((run) => run.projectId === projectId);
  const onBaseBranch = ofProject.find(({ branch }) => branch === baseBranch);
  const newest = ofProject[0];
  return {
    onBaseBranch,
    newer: newest !== undefined && newest !== onBaseBranch ? newest : undefined,
  };
}

/** How many days Recent activity looks back. */
export const ACTIVITY_DAYS = 7;
/** How many lines Recent activity shows at most. */
export const ACTIVITY_LINES = 10;

const DAY_MS = 24 * 60 * 60_000;

/** One line of Recent activity, linking to its record. */
export type ActivityLine =
  | {
      readonly kind: "done";
      readonly task: TaskSummary;
      readonly at: string;
      /** Its commit message was published too, so the one line says both. */
      readonly published: boolean;
    }
  | { readonly kind: "published"; readonly task: TaskSummary; readonly at: string }
  | { readonly kind: "idea-captured"; readonly idea: Idea; readonly at: string }
  | {
      readonly kind: "setting-changed";
      readonly change: ProjectSettingChange;
      readonly at: string;
    };

/**
 * The Project's Tasks done or published, Ideas captured and setting changes in the last 7 days,
 * newest first, 10 at most. A Done Task that was also published is one Done line.
 */
export function activityLines(
  tasks: readonly TaskSummary[],
  ideas: readonly Idea[],
  settingChanges: readonly ProjectSettingChange[],
  projectId: string,
  now: Date,
): ActivityLine[] {
  const since = now.getTime() - ACTIVITY_DAYS * DAY_MS;
  const within = (at: string | null): at is string => at !== null && Date.parse(at) >= since;
  const taskLines = tasks
    .filter((task) => task.projectId === projectId)
    .flatMap((task): ActivityLine[] => {
      const published = task.commitMessagePublishedAt;
      if (task.state === "done" && within(task.endedAt)) {
        return [{ kind: "done", task, at: task.endedAt, published: published !== null }];
      }
      return within(published) ? [{ kind: "published", task, at: published }] : [];
    });
  const ideaLines = ideas
    .filter((idea) => idea.projectId === projectId && within(idea.capturedAt))
    .map((idea): ActivityLine => ({ kind: "idea-captured", idea, at: idea.capturedAt }));
  const settingLines = settingChanges
    .filter((change) => within(change.at))
    .map((change): ActivityLine => ({ kind: "setting-changed", change, at: change.at }));
  return [...taskLines, ...ideaLines, ...settingLines]
    .toSorted((first, second) => second.at.localeCompare(first.at))
    .slice(0, ACTIVITY_LINES);
}

/** The words before an activity line's record; a setting change's are who made it. */
export const ACTIVITY_LEADS: Readonly<
  Record<Exclude<ActivityLine["kind"], "setting-changed">, string>
> = {
  done: "Done:",
  published: "Published:",
  "idea-captured": "Idea captured:",
};

/** A setting change's line: who made it, then what changed, read together as one sentence. */
export interface SettingChangeWords {
  /** "Ann Lee", "Nina (Devops)", or "A Proposal" for one applied before users existed. */
  readonly who: string;
  /** The change's summary; " by Proposal" after it when a user applied a Proposal. */
  readonly what: string;
}

/**
 * "Ann Lee changed Commands", "Ann Lee changed Commands by Proposal", "A Proposal changed
 * Commands" or "Nina (Devops) turned Run environment On".
 */
export function settingChangeWords({ by, summary }: ProjectSettingChange): SettingChangeWords {
  switch (by.kind) {
    case "user":
      return { who: by.user.name, what: summary };
    case "proposal":
      return by.user === null
        ? { who: "A Proposal", what: summary }
        : { who: by.user.name, what: `${summary} by Proposal` };
    case "person":
      return { who: `${by.name} (${by.title})`, what: summary };
  }
}

/** The name of a failed environment check's first failed step; undefined unless it Failed. */
export function firstFailedStep(check: EnvironmentCheck, project: Project): string | undefined {
  if (check.state !== "failed") return undefined;
  const failed = check.checks.find(({ state }) => state === "failed");
  if (failed === undefined) return undefined;
  return failed.step === "worktree"
    ? worktreeCheckLabel(failed, project)
    : commandCheckLabel(failed);
}

/** How the remote's sign-in stands, as the Remote sign-in tile shows it. */
export interface RemoteSignIn {
  /** Success when nothing is missing, warning when something is, neutral when nothing is needed. */
  readonly tone: "success" | "warning" | "neutral";
  readonly needs: string;
  /** What is missing, or the code host refusing reads, in the user's words. */
  readonly problems: readonly string[];
}

/**
 * The remote's needs with what is missing, and the code host refusing to be read, as the CI and
 * pull request listings last found it.
 */
export function remoteSignIn(
  needs: RemoteNeeds,
  ciProblem: CiRunProblem | null | undefined,
  pullRequestProblems: readonly PullRequestProblem[],
): RemoteSignIn {
  const line = remoteNeedsLine(needs);
  const refusals = [
    ...(ciProblem?.kind === "cannot-read" ? [ciProblem.text] : []),
    ...pullRequestProblems.flatMap((problem) =>
      problem.kind === "cannot-read" ? [problem.text] : [],
    ),
  ];
  const problems = [...line.missing, ...new Set(refusals)];
  return {
    tone: problems.length > 0 ? "warning" : line.inSettings ? "success" : "neutral",
    needs: line.needs,
    problems,
  };
}

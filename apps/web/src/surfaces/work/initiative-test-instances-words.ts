import {
  ACTIVE_TEST_INSTANCE_STATES,
  type Author,
  type Initiative,
  type InitiativeTestInstancesProject,
  type InitiativeTestTarget,
  type Role,
  type TestInstance,
  type TestInstanceState,
} from "@the-office/contracts";
import type { BadgeProps } from "@the-office/ui";
import { momentWords, sameDay } from "../../shell/time.ts";
import { userName } from "../../shell/use-user-name.ts";

/** Each state as its badge says it, and the badge's tone (spec §2.12, "Test instance states"). */
export const TEST_INSTANCE_STATE_WORDS: Readonly<Record<TestInstanceState, string>> = {
  building: "Building",
  running: "Running",
  built: "Built",
  stopped: "Stopped",
  failed: "Failed",
};

export const TEST_INSTANCE_STATE_TONES: Readonly<
  Record<TestInstanceState, NonNullable<BadgeProps["tone"]>>
> = {
  building: "info",
  running: "success",
  built: "success",
  stopped: "neutral",
  failed: "danger",
};

/** On an Initiative with no Project on its branch. */
export const NO_INITIATIVE_BRANCH =
  "Test instances launch on an Initiative's branch, and this Initiative publishes Task by Task.";

/** On a Project's group while its Run environment isn't On. */
export const NEEDS_RUN_ENVIRONMENT = "Needs Run environment On to launch.";

/** The block shows once the Initiative is confirmed: active, then Done or Dropped, read-only. */
export function testInstancesShown(initiative: Initiative): boolean {
  return initiative.state !== "shaping";
}

/** Done or Dropped: nothing launches any more. */
export function testInstancesReadOnly(initiative: Initiative): boolean {
  return initiative.state === "done" || initiative.state === "dropped";
}

export function isActive(state: TestInstanceState): boolean {
  return ACTIVE_TEST_INSTANCE_STATES.includes(state);
}

/** The targets the block lists: every kind built now, Hosted and Build to install. */
export function shownTargetsOf(
  project: InitiativeTestInstancesProject,
): readonly InitiativeTestTarget[] {
  return project.targets;
}

/** Only a Hosted target needs the Project's Run environment On; a build runs on the workstation. */
export function needsRunEnvironment(target: InitiativeTestTarget): boolean {
  return target.kind === "hosted";
}

/** A Built instance's files, once a newer build or its Initiative's end removed them. */
export const FILES_REMOVED = "Files removed";

/** Under a Done or Dropped Initiative's Built files, until they go. */
export const FILES_REMOVED_LATER = "Removed 7 days after the Initiative ended.";

/** The QR code window's title. */
export function qrTitle(fileName: string): string {
  return `Install ${fileName} on a phone`;
}

/** Under the QR code: what the link opens, and for how long. */
export const QR_LINK_WORKS = "Works for this file only, for 1 hour.";

/** At localhost, in place of the QR code. */
export const QR_NEEDS_LAN_ADDRESS =
  "A phone can't reach localhost. Open The Office at its LAN address to make a QR code that works there.";

export function qrRefusedTitle(fileName: string): string {
  return `The QR code for ${fileName} can't be made`;
}

function shownInstancesOf(
  projects: readonly InitiativeTestInstancesProject[],
): readonly TestInstance[] {
  return projects.flatMap((project) =>
    shownTargetsOf(project).flatMap(({ instances }) => instances),
  );
}

/** The fold starts open while one of its instances is Building or Running. */
export function testInstancesStartOpen(
  projects: readonly InitiativeTestInstancesProject[] | undefined,
): boolean {
  return projects !== undefined && shownInstancesOf(projects).some(({ state }) => isActive(state));
}

/**
 * The folded line: "1 running · 1 building" (each count only when not 0), "None running" once
 * every instance has ended, or "None launched yet".
 */
export function testInstancesSummary(
  projects: readonly InitiativeTestInstancesProject[] | undefined,
): string {
  if (projects === undefined) return "";
  if (projects.length === 0) return "None: publishes Task by Task";
  const instances = shownInstancesOf(projects);
  const counted = (["running", "building", "built"] as const)
    .map(
      (state) => [state, instances.filter((instance) => instance.state === state).length] as const,
    )
    .filter(([, count]) => count > 0)
    .map(([state, count]) => `${count} ${state}`);
  if (counted.length > 0) return counted.join(" · ");
  return instances.length > 0 ? "None running" : "None launched yet";
}

/** A commit as the row shows it: its first 7 characters. */
export function shortCommit(commit: string | null): string | undefined {
  return commit === null ? undefined : commit.slice(0, 7);
}

/** Where a Running instance is opened: "localhost:4400", or the LAN address The Office has. */
export function instanceAddress(port: number, hostname: string): string {
  return `${hostname}:${port}`;
}

/** The moment a row names: since when it runs, when it ended, or when it was launched. */
export function instanceMoment(instance: TestInstance): string {
  return instance.endedAt ?? instance.runningAt ?? instance.launchedAt;
}

/** "a1b2c3d · 14:02": the instance's commit, once its checkout has it, and its moment. */
export function instanceLine(instance: TestInstance, now: Date = new Date()): string {
  const commit = shortCommit(instance.commit);
  const moment = momentWords(instanceMoment(instance), now);
  return commit === undefined ? moment : `${commit} · ${moment}`;
}

/** On a row whose instance runs an older commit than the branch's tip, which a new launch would. */
export const NEWER_COMMITS = "Newer commits on the branch";

/** Whether the branch has moved past the instance's commit, as far as The Office knows its tip. */
export function branchMovedPast(instance: TestInstance, branchCommit: string | null): boolean {
  return instance.commit !== null && branchCommit !== null && instance.commit !== branchCommit;
}

export function earlierWords(count: number): string {
  return `${count} earlier`;
}

export function launchRefusedTitle(targetName: string): string {
  return `${targetName} can't launch`;
}

export function openRefusedTitle(targetName: string): string {
  return `${targetName} can't open`;
}

export function stoppedToast(targetName: string): string {
  return `${targetName} stopped.`;
}

/** Why Launch is disabled, on hover. */
export function launchDisabledWhy(projectName: string): string {
  return `Needs Run environment On in ${projectName}`;
}

export function noTestTargetsWords(projectName: string): string {
  return `No test targets in ${projectName}.`;
}

/** The foot of the block: what a launch runs, or that nothing launches once ended. */
export function testInstancesFoot(initiative: Initiative): string {
  if (initiative.state === "done") {
    return "Done: nothing can be launched any more. Each log stays with its instance.";
  }
  if (initiative.state === "dropped") {
    return "Dropped: nothing can be launched any more. Each log stays with its instance.";
  }
  return "Each launch runs the branch's tip, fetched first, on its own checkout and data.";
}

/** The Log window's title: "Office · Running". */
export function logTitle(instance: TestInstance): string {
  return `${instance.targetName} · ${TEST_INSTANCE_STATE_WORDS[instance.state]}`;
}

/** "Launched by you at 14:02" today, "… on 25 Oct, 14:02" before; by another user or person. */
export function launchedWords(
  instance: TestInstance,
  roles: readonly Role[] | undefined,
  signedInUserId: string | undefined,
  now: Date = new Date(),
): string {
  const when = sameDay(instance.launchedAt, now) ? "at" : "on";
  return `Launched by ${launcherName(instance.launchedBy, roles, signedInUserId)} ${when} ${momentWords(
    instance.launchedAt,
    now,
  )}`;
}

function launcherName(
  author: Author,
  roles: readonly Role[] | undefined,
  signedInUserId: string | undefined,
): string {
  if (author.kind === "user") return userName(author.user, signedInUserId, "you");
  return roles?.find(({ key }) => key === author.roleKey)?.card.name ?? author.roleKey;
}

/** A line of the log: The Office's own, the reason it failed, or the entry point's output. */
export interface LogLine {
  readonly kind: "office" | "failed" | "output";
  readonly text: string;
}

const OFFICE_LINE = "[The Office] ";

/** The log's lines as the window shows them, The Office's own marked, the last empty one left out. */
export function logLinesOf(text: string): readonly LogLine[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line) => {
    if (!line.startsWith(OFFICE_LINE)) return { kind: "output", text: line };
    const own = line.slice(OFFICE_LINE.length);
    return { kind: own.startsWith("Failed: ") ? "failed" : "office", text: own };
  });
}

import type {
  Initiative,
  InitiativeTestInstancesProject,
  InitiativeTestTarget,
  TestInstance,
} from "@the-office/contracts";
import { isActive } from "../../shell/test-instances/test-instance-words.ts";

/** On an Initiative with no Project on its branch. */
export const NO_INITIATIVE_BRANCH =
  "Test instances launch on an Initiative's branch, and this Initiative publishes Task by Task.";

/** The block shows once the Initiative is confirmed: active, then Done or Dropped, read-only. */
export function testInstancesShown(initiative: Initiative): boolean {
  return initiative.state !== "shaping";
}

/** Done or Dropped: nothing launches any more. */
export function testInstancesReadOnly(initiative: Initiative): boolean {
  return initiative.state === "done" || initiative.state === "dropped";
}

/** The targets the block lists: every kind built now, Hosted and Build to install. */
export function shownTargetsOf(
  project: InitiativeTestInstancesProject,
): readonly InitiativeTestTarget[] {
  return project.targets;
}

/** Under a Done or Dropped Initiative's Built files, until they go. */
export const FILES_REMOVED_LATER = "Removed 7 days after the Initiative ended.";

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

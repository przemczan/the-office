import { dirname, join } from "node:path";
import type { BriefProject } from "../domain/brief.js";
import type { ProjectBases } from "./project-bases.js";

/** ProjectBases as a plain object, which a test can spread to replace one of its methods. */
export type ProjectBasesStandIn = Pick<ProjectBases, keyof ProjectBases>;

/**
 * Project bases that list `projects` as they are, wherever a session reads them, and run no git;
 * the Initiatives' checkouts are beside `basesFolder`, as in the Office's data directory.
 */
export function projectBasesOver(
  basesFolder: string,
  projects: readonly BriefProject[],
): ProjectBasesStandIn {
  return {
    folder: basesFolder,
    list: () => Promise.resolve(projects),
    refresh: () => Promise.resolve(projects),
    initiativeFolder: (shortName) => join(dirname(basesFolder), "initiative-bases", shortName),
    listOnInitiative: () => Promise.resolve(projects),
    refreshOnInitiative: () => Promise.resolve(projects),
  };
}

/** Project bases with no Project in them, so a chat session runs no git. */
export function noProjectBases(basesFolder: string): ProjectBasesStandIn {
  return projectBasesOver(basesFolder, []);
}

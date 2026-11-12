import { useQuery } from "@tanstack/react-query";
import type { Project } from "@the-office/contracts";
import { projectQueries } from "../../api/projects.ts";
import { publishingLabel } from "../project-words.ts";
import type { StageCommandSource } from "./stage-commands.ts";

/**
 * Every Project's commands, which a library Pipeline's or a Stage template's Script Stage picks a
 * key from: each Project runs its own command by that key.
 */
export function useLibraryCommands(): StageCommandSource {
  const projects = useQuery(projectQueries.list()).data ?? [];
  return { kind: "library", projects };
}

/**
 * A Project Pipeline's commands: its own Project's alone (spec §2.3, "Project Pipelines"), as only
 * that Project's Tasks run it.
 */
export function projectCommandsOf(project: Project): StageCommandSource {
  return {
    kind: "project",
    commands: project.commands,
    publishing: publishingLabel(project.publishingMode, project.baseBranch).toLowerCase(),
  };
}

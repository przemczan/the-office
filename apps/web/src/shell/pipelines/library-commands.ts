import { useQuery } from "@tanstack/react-query";
import { projectQueries } from "../../api/projects.ts";
import type { StageCommandSource } from "./stage-commands.ts";

/**
 * Every Project's commands, which a library Pipeline's or a Stage template's Script Stage picks a
 * key from: each Project runs its own command by that key.
 */
export function useLibraryCommands(): StageCommandSource {
  const projects = useQuery(projectQueries.list()).data ?? [];
  return { kind: "library", projects };
}

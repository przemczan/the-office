import type { ProjectPipelineBreak } from "@the-office/contracts";
import { counted } from "../../../shell/pipelines/stage-change-words.ts";

/** The Project Pipelines a save breaks, by their Project, in the order the check lists them. */
export interface BreaksOfProject {
  readonly projectId: string;
  readonly projectName: string;
  readonly breaks: readonly ProjectPipelineBreak[];
}

export function breaksByProject(breaks: readonly ProjectPipelineBreak[]): BreaksOfProject[] {
  const byProject = new Map<string, BreaksOfProject>();
  for (const projectPipelineBreak of breaks) {
    const { projectId, projectName } = projectPipelineBreak;
    const group = byProject.get(projectId) ?? { projectId, projectName, breaks: [] };
    byProject.set(projectId, { ...group, breaks: [...group.breaks, projectPipelineBreak] });
  }
  return [...byProject.values()];
}

/** "Saving Full breaks 2 Project Pipelines", or "Saving breaks …" in the editor's own warning. */
export function breaksTitle(pipelineName: string | undefined, breaks: number): string {
  const saving = pipelineName === undefined ? "Saving" : `Saving ${pipelineName}`;
  return `${saving} breaks ${counted(breaks, "Project Pipeline", "Project Pipelines")}`;
}

/** "the-office's Full with Linux check and UI change, and notnullsoft's Full with visual check". */
export function breaksSentence(breaks: readonly ProjectPipelineBreak[]): string {
  const parts = breaksByProject(breaks).map(
    ({ projectName, breaks: ofProject }) =>
      `${projectName}'s ${listWords(ofProject.map(({ name }) => name))}`,
  );
  return listWords(parts, ", and ");
}

function listWords(words: readonly string[], lastJoin = " and "): string {
  if (words.length < 2) return words.join("");
  return `${words.slice(0, -1).join(", ")}${lastJoin}${words.at(-1)}`;
}

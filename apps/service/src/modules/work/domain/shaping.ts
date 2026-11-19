import { READ_ONLY_SHELL_RULE } from "../../engine/index.js";
import type { PromptTexts } from "../../prompt-templates/index.js";
import { authorWords } from "./author.js";
import { pipelineIn, type Initiative } from "./initiative.js";
import { pipelineGroups, type PlanningPipeline } from "./planning.js";
import { renderedText } from "./rendered-text.js";
import {
  CREATED_INITIATIVE_SHAPING_OPENING,
  SHAPING_BRIEF,
  SHAPING_INSTRUCTIONS,
  SHAPING_OPENING,
} from "./work-prompt-templates.js";

export const SHAPING_THREAD_TITLE = "Shaping";

/**
 * What whoever shapes Initiatives does in an Initiative's shaping Thread, after their card's
 * instructions. The same for every session of it, so it stays in the cached prefix.
 */
export function shapingInstructions(prompts: PromptTexts): string {
  return renderedText(prompts, SHAPING_INSTRUCTIONS, { readOnlyShellRule: READ_ONLY_SHELL_RULE });
}

/**
 * The Office's first message in a new Thread on an Initiative, after the Brief, by whether it was
 * shaped from an Idea or created with create_initiative, from none.
 */
export function shapingOpeningOf(prompts: PromptTexts, initiative: Initiative): string {
  return initiative.originIdeaId === undefined
    ? renderedText(prompts, CREATED_INITIATIVE_SHAPING_OPENING, {})
    : renderedText(prompts, SHAPING_OPENING, {});
}

/** A Project the Initiative spans, as the shaping Brief lists its Pipelines. */
export interface ShapingProject {
  readonly id: string;
  readonly name: string;
  /** Its Project Pipelines, which only its Tasks and the Initiative's Pipeline there can follow. */
  readonly ownPipelines: readonly PlanningPipeline[];
}

/**
 * The shaping Brief: the Initiative's record, who shaped or created it, the Project its Idea was
 * captured in when it was, then the Pipelines each Project it spans may follow, with what each follows now.
 */
export function shapingBrief(
  prompts: PromptTexts,
  initiative: Initiative,
  ideaProjectId: string | undefined,
  record: string,
  projects: readonly ShapingProject[],
  officeWide: readonly PlanningPipeline[],
): string {
  const known = [...officeWide, ...projects.flatMap(({ ownPipelines }) => ownPipelines)];
  const pipelineNameIn = (projectId: string) => {
    const pipelineId = pipelineIn(initiative, projectId);
    if (pipelineId === undefined) return "";
    return known.find((pipeline) => pipeline.id === pipelineId)?.name ?? pipelineId;
  };
  return renderedText(prompts, SHAPING_BRIEF, {
    record,
    createdFromIdea: initiative.originIdeaId !== undefined,
    createdBy: authorWords(initiative.createdBy),
    ideaProjectId: ideaProjectId ?? "",
    shaping: initiative.state === "shaping",
    hasProjects: projects.length > 0,
    projects: projects.map(({ id, name }) => ({ id, name, pipeline: pipelineNameIn(id) })),
    pipelineLibrary: pipelineGroups(
      projects.map(({ name, ownPipelines }) => ({
        project: { name, defaultPipeline: "" },
        own: ownPipelines,
      })),
      officeWide,
    ).join("\n\n"),
  });
}

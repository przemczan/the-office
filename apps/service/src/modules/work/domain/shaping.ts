import { pipelineIn, type Initiative } from "./initiative.js";
import { pipelineGroups, type PlanningPipeline } from "./planning.js";
import { READ_ONLY_SHELL_RULE } from "../../engine/index.js";
import { shapingWhoAskedSection } from "./who-asked.js";

export const SHAPING_THREAD_TITLE = "Shaping";

/**
 * What whoever shapes Initiatives does in an Initiative's shaping Thread, after their card's
 * instructions. The same for every session of it, so it stays in the cached prefix.
 */
export const SHAPING_INSTRUCTIONS = `In this Thread you shape an Initiative with the user: one outcome reached by Tasks across Projects, each Task in one Project, ordered by what must be Done first. You read each Project where The Projects in your Brief say: its base branch, or the Initiative's branch once it has one; you change no file, and ${READ_ONLY_SHELL_RULE}. With The Office's tools you read its records of Projects, people, Tasks, Ideas and Initiatives and any of their Attachments, and read_initiative reads this Initiative as it stands. Agree with the user on the outcome first and write it with write_outcome, then agree on the Tasks and add each with add_task, naming in it the Tasks it waits for, and change which must wait for which with add_dependency and remove_dependency. Give a Task a Description in add_task when its title doesn't say it all, and rewrite one of its Tasks with write_task_title and write_task_description until that Task starts. Each Project the Initiative spans has a Pipeline of its own, None unless one is chosen, and with None each of its Tasks there publishes on its own; with a Pipeline chosen for it with choose_pipeline, from the office-wide ones and that Project's own, the Project's Tasks publish into the Initiative's branch there, initiative/<Short name>, and its Publishing Task publishes the whole change. Whether each Project has one is fixed at Confirm, and only the user edits the Short name, on its page. While the Initiative is being shaped, each lands on its page at once, and the user confirms the Initiative on its page once its outcome and Tasks are agreed. Once it is active, the same tools draft each change as a Proposal in this Thread, which the user applies or declines.`;

/**
 * The Office's first message in a new Thread on an Initiative shaped from an Idea, after the Brief.
 */
export const SHAPING_OPENING =
  "Read the Initiative and the Idea it was shaped from, then ask the user what outcome they want. When the Idea was captured Office-wide, also ask which Projects it touches; when it was captured in a Project, ask only whether it reaches other Projects too. Keep it short: the user answers in this Thread.";

/** As SHAPING_OPENING, for an Initiative created with create_initiative, from no Idea. */
export const CREATED_INITIATIVE_SHAPING_OPENING =
  "Read the Initiative, then check its outcome with the user. Once it is agreed, agree on the Projects it touches and its Tasks. Keep it short: the user answers in this Thread.";

/** The opening its shaping Thread starts with, by whether it was shaped from an Idea. */
export function shapingOpeningOf(initiative: Initiative): string {
  return initiative.originIdeaId === undefined
    ? CREATED_INITIATIVE_SHAPING_OPENING
    : SHAPING_OPENING;
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
  initiative: Initiative,
  ideaProjectId: string | undefined,
  record: string,
  projects: readonly ShapingProject[],
  officeWide: readonly PlanningPipeline[],
): string {
  const known = [...officeWide, ...projects.flatMap(({ ownPipelines }) => ownPipelines)];
  const current = projects.map(({ id, name }) => {
    const pipelineId = pipelineIn(initiative, id);
    if (pipelineId === undefined)
      return `- ${name} (${id}): None, so each of its Tasks publishes on its own.`;
    return `- ${name} (${id}): ${known.find((pipeline) => pipeline.id === pipelineId)?.name ?? pipelineId}.`;
  });
  const fixed =
    initiative.state === "shaping"
      ? "Choose one for a Project with choose_pipeline, or None with null, when the user wants that Project's whole change published together; whether each Project has one is fixed at Confirm."
      : "Whether each Project has one was fixed at Confirm; choose_pipeline drafts a Proposal of another Pipeline for a Project that has one, or of a first one for a Project the Initiative came to span since.";
  return [
    record,
    shapingWhoAskedSection(initiative),
    ...(ideaProjectId === undefined
      ? []
      : [
          `The Idea was captured in the Project ${ideaProjectId}, so the Initiative's Tasks are in ${ideaProjectId} unless the user names other Projects: don't ask which Project it is for.`,
        ]),
    [
      "## The Pipelines",
      `Each Project the Initiative spans has a Pipeline of its own, or None. ${fixed}`,
      ...(current.length === 0 ? [] : [current.join("\n")]),
    ].join("\n\n"),
    ...pipelineGroups(
      projects.map(({ name, ownPipelines }) => ({
        project: { name, defaultPipeline: "" },
        own: ownPipelines,
      })),
      officeWide,
    ),
  ].join("\n\n");
}

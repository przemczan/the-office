import type { Initiative } from "./initiative.js";
import { pipelineLibraryLines, type PlanningPipeline } from "./planning.js";
import { READ_ONLY_SHELL_RULE } from "../../engine/index.js";

/** The Role that shapes Initiatives, by the key a hired CTO keeps (spec §2.2). */
export const CTO = "cto";

export const SHAPING_THREAD_TITLE = "Shaping";

/**
 * What the CTO does in an Initiative's Thread, after their card's instructions. The same for every
 * session of it, so it stays in the cached prefix.
 */
export const SHAPING_INSTRUCTIONS = `In this Thread you shape an Initiative with the user: one outcome reached by Tasks across Projects, each Task in one Project, ordered by what must be Done first. You read each Project where The Projects in your Brief say: its base branch, or the Initiative's branch once it has one; you change no file, and ${READ_ONLY_SHELL_RULE}. With The Office's tools you read its records of Projects, people, Tasks, Ideas and Initiatives and any of their Attachments, and read_initiative reads this Initiative as it stands. Agree with the user on the outcome first and write it with write_outcome, then agree on the Tasks and add each with add_task, naming in it the Tasks it waits for, and change which must wait for which with add_dependency and remove_dependency. Give a Task a Description in add_task when its title doesn't say it all, and rewrite one of its Tasks with write_task_title and write_task_description until that Task starts. The Initiative's Pipeline is None unless one is chosen, and each of its Tasks then publishes on its own; with a library Pipeline chosen with choose_pipeline, its Tasks publish into the Initiative's branch, initiative/<Short name>, in each Project it spans, and its Publishing Tasks publish the whole change. Whether it has one is fixed at Confirm, and only the user edits its Short name, on its page. While the Initiative is being shaped, each lands on its page at once, and the user confirms the Initiative on its page once its outcome and Tasks are agreed. Once it is active, the same tools draft each change as a Proposal in this Thread, which the user applies or declines.`;

/** The Office's first message in a new Thread on an Initiative, after the Brief. */
export const SHAPING_OPENING =
  "Read the Initiative and the Idea it was shaped from, then ask the user what outcome they want. When the Idea was captured Office-wide, also ask which Projects it touches; when it was captured in a Project, ask only whether it reaches other Projects too. Keep it short: the user answers in this Thread.";

/**
 * The CTO's shaping Brief: the Initiative's record, the Project its Idea was captured in when it
 * was, then the library's Pipelines it may follow, with what it follows now.
 */
export function shapingBrief(
  initiative: Initiative,
  ideaProjectId: string | undefined,
  record: string,
  pipelines: readonly PlanningPipeline[],
): string {
  const current =
    initiative.pipelineId === undefined
      ? "The Initiative's Pipeline is None, so each of its Tasks publishes on its own."
      : `The Initiative follows ${pipelines.find(({ id }) => id === initiative.pipelineId)?.name ?? initiative.pipelineId}.`;
  const fixed =
    initiative.state === "shaping"
      ? "Choose one with choose_pipeline, or None with null, when the user wants the whole change published together; whether it has one is fixed at Confirm."
      : "Whether it has one was fixed at Confirm; choose_pipeline drafts a Proposal of another library Pipeline.";
  return [
    record,
    ...(ideaProjectId === undefined
      ? []
      : [
          `The Idea was captured in the Project ${ideaProjectId}, so the Initiative's Tasks are in ${ideaProjectId} unless the user names other Projects: don't ask which Project it is for.`,
        ]),
    `## The Pipelines\n\n${current} ${fixed}`,
    pipelineLibraryLines(pipelines).join("\n"),
  ].join("\n\n");
}

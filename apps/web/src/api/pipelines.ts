import { queryOptions } from "@tanstack/react-query";
import {
  officeWidePipelineListSchema,
  pipelineCheckSchema,
  pipelineSchema,
  pipelinesWebEventSchema,
  pipelineUseSchema,
  projectPipelineCheckSchema,
  projectPipelineListSchema,
  projectPipelineSchema,
  stageRunCommandOutputsSchema,
  standInChoicesResponseSchema,
  standInSwitchResponseSchema,
  stagesCheckSchema,
  stageTemplateListSchema,
  stageTemplateSchema,
  taskStagesSchema,
  type Pipeline,
  type PipelineCheckRequest,
  type PipelineEdit,
  type PipelinesWebEvent,
  type ProjectPipeline,
  type ProjectPipelineCheckRequest,
  type ProjectPipelineEdit,
  type NewProjectPipeline,
  type SendBack,
  type ContinueAtGate,
  type Stage,
  type StageTemplate,
  type StageTemplateCheckRequest,
  type StandInSwitchResult,
  type TaskStages,
} from "@the-office/contracts";
import { deleteFromApi, getFromApi, sendToApi } from "./api-client.ts";
import { taskChangesKey } from "./projects.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";
import { PIPELINES_KEY, PROJECT_PIPELINES_KEY, STAGE_TEMPLATES_KEY } from "./pipeline-keys.ts";

/** Apart from the Task's key, or the walk's and Work's events would read a run's whole output again. */
const COMMAND_OUTPUTS_KEY: readonly unknown[] = ["stage-run-command-outputs"];

const STAND_IN_CHOICES_KEY: readonly unknown[] = ["stand-in-choices"];

export const pipelineQueries = {
  list: () =>
    queryOptions({
      queryKey: PIPELINES_KEY,
      queryFn: ({ signal }) => getFromApi("/pipelines", officeWidePipelineListSchema, signal),
    }),
  /** Who uses a library Pipeline; under the library, so any change to it reads this again. */
  use: (pipelineId: string) =>
    queryOptions({
      queryKey: [...PIPELINES_KEY, pipelineId, "use"],
      queryFn: ({ signal }) =>
        getFromApi(`${pipelinePath(pipelineId)}/use`, pipelineUseSchema, signal),
    }),
  /** What saving a library Pipeline would be refused for and what it only warns about. */
  libraryCheck: (request: PipelineCheckRequest) =>
    queryOptions({
      queryKey: [...PIPELINES_KEY, "check", request],
      queryFn: () => sendToApi("POST", "/pipelines/check", request, pipelineCheckSchema),
    }),
  /** Under the Task's key, so Work's events about the Task refresh it too. */
  taskStages: (taskId: string) =>
    queryOptions({
      queryKey: taskStagesKey(taskId),
      queryFn: ({ signal }) => getFromApi(stagesPath(taskId), taskStagesSchema, signal),
    }),
  /** What each of a run's commands printed, saved as they end, so a run's end reads it again. */
  commandOutputs: (taskId: string, runId: string) =>
    queryOptions({
      queryKey: [...commandOutputsKey(taskId), runId],
      queryFn: ({ signal }) =>
        getFromApi(
          `/tasks/${encodeURIComponent(taskId)}/stage-runs/${encodeURIComponent(runId)}/command-outputs`,
          stageRunCommandOutputsSchema,
          signal,
        ),
    }),
  /**
   * What saving the edited Stages would be refused for, as if the Task followed `pipelineId`, the
   * Pipeline the draft follows. Under the Task's Stages, so whatever makes those stale checks the
   * edit again.
   */
  stagesCheck: (taskId: string, stages: readonly Stage[], pipelineId: string) =>
    queryOptions({
      queryKey: [...taskStagesKey(taskId), "check", pipelineId, stages],
      queryFn: () =>
        sendToApi("POST", `${stagesPath(taskId)}/check`, { stages, pipelineId }, stagesCheckSchema),
    }),
};

export const standInChoiceQueries = {
  /**
   * The Stages held as their engine's usage window was used up, waiting for the user's choice of a
   * Stand-in Engine now or the reset: the rows of The Office's own Decision in Needs you.
   */
  list: () =>
    queryOptions({
      queryKey: STAND_IN_CHOICES_KEY,
      queryFn: async ({ signal }) =>
        (await getFromApi("/stand-in-choices", standInChoicesResponseSchema, signal)).choices,
    }),
};

export const projectPipelineQueries = {
  /** The Project's Project Pipelines, each built from its base Pipeline's current Stages. */
  list: (projectId: string) =>
    queryOptions({
      queryKey: [...PROJECT_PIPELINES_KEY, { projectId }],
      queryFn: ({ signal }) =>
        getFromApi(
          `/project-pipelines?projectId=${encodeURIComponent(projectId)}`,
          projectPipelineListSchema,
          signal,
        ),
    }),
  /** Every Project's Project Pipelines, for finding one by its id wherever a Task names it. */
  every: () =>
    queryOptions({
      queryKey: PROJECT_PIPELINES_KEY,
      queryFn: ({ signal }) => getFromApi("/project-pipelines", projectPipelineListSchema, signal),
    }),
  read: (projectPipelineId: string) =>
    queryOptions({
      queryKey: [...PROJECT_PIPELINES_KEY, projectPipelineId],
      queryFn: ({ signal }) =>
        getFromApi(projectPipelinePath(projectPipelineId), projectPipelineSchema, signal),
    }),
  /** Who uses a Project Pipeline: its Project's default, and the Tasks on it. */
  use: (projectPipelineId: string) =>
    queryOptions({
      queryKey: [...PROJECT_PIPELINES_KEY, projectPipelineId, "use"],
      queryFn: ({ signal }) =>
        getFromApi(`${projectPipelinePath(projectPipelineId)}/use`, pipelineUseSchema, signal),
    }),
  /** What saving the edit would be refused for and only warned about, and the Stages it builds. */
  check: (request: ProjectPipelineCheckRequest) =>
    queryOptions({
      queryKey: [...PROJECT_PIPELINES_KEY, "check", request],
      queryFn: () =>
        sendToApi("POST", "/project-pipelines/check", request, projectPipelineCheckSchema),
    }),
};

export const stageTemplateQueries = {
  list: () =>
    queryOptions({
      queryKey: STAGE_TEMPLATES_KEY,
      queryFn: ({ signal }) => getFromApi("/stage-templates", stageTemplateListSchema, signal),
    }),
  /** What saving a Stage template would be refused for and what it only warns about. */
  check: (request: StageTemplateCheckRequest) =>
    queryOptions({
      queryKey: [...STAGE_TEMPLATES_KEY, "check", request],
      queryFn: () => sendToApi("POST", "/stage-templates/check", request, pipelineCheckSchema),
    }),
};

/** A Pipeline made from scratch in the library. */
export function addPipeline(edit: PipelineEdit): Promise<Pipeline> {
  return sendToApi("POST", "/pipelines", edit, pipelineSchema);
}

/** A copy of a library Pipeline, named "… (copy)". */
export function duplicatePipeline(pipelineId: string): Promise<Pipeline> {
  return sendToApi("POST", "/pipelines", { copyOf: pipelineId }, pipelineSchema);
}

/** The library Pipeline saved: Tasks that haven't started follow it; running ones keep their copy. */
export function savePipeline(pipelineId: string, edit: PipelineEdit): Promise<Pipeline> {
  return sendToApi("PUT", pipelinePath(pipelineId), edit, pipelineSchema);
}

export function removePipeline(pipelineId: string): Promise<void> {
  return deleteFromApi(pipelinePath(pipelineId));
}

/** A Project Pipeline of the Project, built from an office-wide Pipeline. */
export function addProjectPipeline(
  newProjectPipeline: NewProjectPipeline,
): Promise<ProjectPipeline> {
  return sendToApi("POST", "/project-pipelines", newProjectPipeline, projectPipelineSchema);
}

/** Refused while it would be Broken: only an office-wide Pipeline's save breaks one. */
export function saveProjectPipeline(
  projectPipelineId: string,
  edit: ProjectPipelineEdit,
): Promise<ProjectPipeline> {
  return sendToApi("PUT", projectPipelinePath(projectPipelineId), edit, projectPipelineSchema);
}

export function removeProjectPipeline(projectPipelineId: string): Promise<void> {
  return deleteFromApi(projectPipelinePath(projectPipelineId));
}

/** A Stage template made from scratch, or a Stage saved as one; its failure rule is dropped. */
export function addStageTemplate(stage: Stage): Promise<StageTemplate> {
  return sendToApi("POST", "/stage-templates", { stage }, stageTemplateSchema);
}

/** The template saved: Pipelines and Tasks that added it keep their copy as it was. */
export function saveStageTemplate(stageTemplateId: string, stage: Stage): Promise<StageTemplate> {
  return sendToApi("PUT", stageTemplatePath(stageTemplateId), { stage }, stageTemplateSchema);
}

export function removeStageTemplate(stageTemplateId: string): Promise<void> {
  return deleteFromApi(stageTemplatePath(stageTemplateId));
}

/** Edit for this Task: the Task's Stages replaced, the library Pipeline left as it is. */
export function editTaskStages(taskId: string, stages: readonly Stage[]): Promise<TaskStages> {
  return sendToApi("PUT", stagesPath(taskId), { stages }, taskStagesSchema);
}

/**
 * The Gate's actions; each answers the Task's Stages after it. Continue may bring notes for the
 * Agent Stages after the Gate.
 */
export function continueAtGate(taskId: string, notes?: string): Promise<TaskStages> {
  const body: ContinueAtGate = notes === undefined ? {} : { feedback: notes };
  return sendToApi("POST", `${gatePath(taskId)}/continue`, body, taskStagesSchema);
}

export function sendBackFromGate(taskId: string, sendBack: SendBack): Promise<TaskStages> {
  return sendToApi("POST", `${gatePath(taskId)}/send-back`, sendBack, taskStagesSchema);
}

export function dropAtGate(taskId: string): Promise<TaskStages> {
  return sendToApi("POST", `${gatePath(taskId)}/drop`, {}, taskStagesSchema);
}

/** Moves the held runs to a Stand-in Engine now, each Task on its own; answers each run's result. */
export async function switchToStandIn(
  runIds: readonly string[],
): Promise<readonly StandInSwitchResult[]> {
  const response = await sendToApi(
    "POST",
    "/stand-in-choices/switch",
    { runIds },
    standInSwitchResponseSchema,
  );
  return response.results;
}

function pipelinePath(pipelineId: string): `/${string}` {
  return `/pipelines/${encodeURIComponent(pipelineId)}`;
}

function projectPipelinePath(projectPipelineId: string): `/${string}` {
  return `/project-pipelines/${encodeURIComponent(projectPipelineId)}`;
}

function stageTemplatePath(stageTemplateId: string): `/${string}` {
  return `/stage-templates/${encodeURIComponent(stageTemplateId)}`;
}

function stagesPath(taskId: string): `/${string}` {
  return `/tasks/${encodeURIComponent(taskId)}/stages`;
}

function gatePath(taskId: string): `/${string}` {
  return `/tasks/${encodeURIComponent(taskId)}/gate`;
}

function taskStagesKey(taskId: string): readonly unknown[] {
  return ["tasks", taskId, "stages"];
}

function commandOutputsKey(taskId: string): readonly unknown[] {
  return [...COMMAND_OUTPUTS_KEY, taskId];
}

/** A change to the library, or to a Project Pipeline, makes every list of both stale. */
function staleLibrary(): readonly (readonly unknown[])[] {
  return [PIPELINES_KEY];
}

/** A change to a Stage template makes every list of them stale. */
function staleStageTemplates(): readonly (readonly unknown[])[] {
  return [STAGE_TEMPLATES_KEY];
}

/** Each of the walk's events makes the Stages of the Task it names stale. */
function staleTaskStages(event: unknown): readonly (readonly unknown[])[] {
  return [taskStagesKey(taskIdOf(event))];
}

/**
 * A run's end also makes the Task's Changes stale, as The Office commits the Stage's work then, and
 * its commands' outputs, saved then.
 */
function staleTaskStagesAndChanges(event: unknown): readonly (readonly unknown[])[] {
  const taskId = taskIdOf(event);
  return [taskStagesKey(taskId), taskChangesKey(taskId), commandOutputsKey(taskId)];
}

/** The Stages waiting for the user's choice of a Stand-in Engine changed. */
function staleStandInChoices(): readonly (readonly unknown[])[] {
  return [STAND_IN_CHOICES_KEY];
}

function taskIdOf(event: unknown): string {
  const parsed = pipelinesWebEventSchema.parse(event);
  if (!("taskId" in parsed)) throw new Error(`A ${parsed.type} event names no Task.`);
  return parsed.taskId;
}

export const pipelineEventInvalidations: Readonly<
  Record<PipelinesWebEvent["type"], EventInvalidations[string]>
> = {
  "pipeline.added": staleLibrary,
  "pipeline.saved": staleLibrary,
  "pipeline.removed": staleLibrary,
  "stage-template.added": staleStageTemplates,
  "stage-template.saved": staleStageTemplates,
  "stage-template.removed": staleStageTemplates,
  "task-stages.made": staleTaskStages,
  "task-stages.edited": staleTaskStages,
  "task-stages.reset": staleTaskStages,
  "stage-run.started": staleTaskStages,
  "stage-run.thread-opened": staleTaskStages,
  "stage-run.waiting": staleTaskStages,
  "stage-run.engine-switched": staleTaskStages,
  "stand-in-choices.changed": staleStandInChoices,
  "stage-run.ended": staleTaskStagesAndChanges,
  "stage-run.stop-held-as-pause": staleTaskStages,
  "stage-run.went-back": staleTaskStages,
  "stage-run.budget-reached": staleTaskStages,
  "stage-run.no-retries-left": staleTaskStages,
  "pipeline.definition-of-done-not-met": staleTaskStages,
  "pipeline.completed": staleTaskStages,
  "gate.reached": staleTaskStages,
  "gate.continued": staleTaskStages,
  "gate.sent-back": staleTaskStages,
  "gate.dropped": staleTaskStages,
};

import { queryOptions } from "@tanstack/react-query";
import {
  pipelineCheckSchema,
  pipelineListSchema,
  pipelineSchema,
  pipelinesWebEventSchema,
  pipelineUseSchema,
  stageRunCommandOutputsSchema,
  stagesCheckSchema,
  stageTemplateListSchema,
  stageTemplateSchema,
  taskStagesSchema,
  type Pipeline,
  type PipelineCheckRequest,
  type PipelineEdit,
  type PipelinesWebEvent,
  type SendBack,
  type Stage,
  type StageTemplate,
  type StageTemplateCheckRequest,
  type TaskStages,
} from "@the-office/contracts";
import { deleteFromApi, getFromApi, sendToApi } from "./api-client.ts";
import { taskChangesKey } from "./projects.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const PIPELINES_KEY: readonly unknown[] = ["pipelines"];

const STAGE_TEMPLATES_KEY: readonly unknown[] = ["stage-templates"];

/** Apart from the Task's key, or the walk's and Work's events would read a run's whole output again. */
const COMMAND_OUTPUTS_KEY: readonly unknown[] = ["stage-run-command-outputs"];

export const pipelineQueries = {
  list: () =>
    queryOptions({
      queryKey: PIPELINES_KEY,
      queryFn: ({ signal }) => getFromApi("/pipelines", pipelineListSchema, signal),
    }),
  /** Who uses a library Pipeline; under the library, so any change to it reads this again. */
  use: (pipelineId: string) =>
    queryOptions({
      queryKey: [...PIPELINES_KEY, pipelineId, "use"],
      queryFn: ({ signal }) =>
        getFromApi(`${pipelinePath(pipelineId)}/use`, pipelineUseSchema, signal),
    }),
  /** What saving a library Pipeline would be refused for and what it only flags. */
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
   * What saving the edited Stages would be refused for. Under the Task's Stages, so whatever makes
   * those stale checks the edit again.
   */
  stagesCheck: (taskId: string, stages: readonly Stage[]) =>
    queryOptions({
      queryKey: [...taskStagesKey(taskId), "check", stages],
      queryFn: () =>
        sendToApi("POST", `${stagesPath(taskId)}/check`, { stages }, stagesCheckSchema),
    }),
};

export const stageTemplateQueries = {
  list: () =>
    queryOptions({
      queryKey: STAGE_TEMPLATES_KEY,
      queryFn: ({ signal }) => getFromApi("/stage-templates", stageTemplateListSchema, signal),
    }),
  /** What saving a Stage template would be refused for and what it only flags. */
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

/** The Gate's actions; each answers the Task's Stages after it. */
export function continueAtGate(taskId: string): Promise<TaskStages> {
  return sendToApi("POST", `${gatePath(taskId)}/continue`, {}, taskStagesSchema);
}

export function sendBackFromGate(taskId: string, sendBack: SendBack): Promise<TaskStages> {
  return sendToApi("POST", `${gatePath(taskId)}/send-back`, sendBack, taskStagesSchema);
}

export function dropAtGate(taskId: string): Promise<TaskStages> {
  return sendToApi("POST", `${gatePath(taskId)}/drop`, {}, taskStagesSchema);
}

function pipelinePath(pipelineId: string): `/${string}` {
  return `/pipelines/${encodeURIComponent(pipelineId)}`;
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

/** A change to the library makes every list of it stale. */
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
  "stage-run.ended": staleTaskStagesAndChanges,
  "stage-run.skipped": staleTaskStages,
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

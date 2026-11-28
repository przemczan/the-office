import { queryOptions, type QueryClient } from "@tanstack/react-query";
import {
  CHANGE_PROJECT_PIPELINE_ACTION,
  CREATE_PROJECT_PIPELINE_ACTION,
  DELETE_PROJECT_PIPELINE_ACTION,
  officeWidePipelineListSchema,
  pipelineCheckSchema,
  pipelineSchema,
  pipelinesNeedingFixingSchema,
  linkedStageListSchema,
  pipelinesWebEventSchema,
  pipelineUseSchema,
  projectPipelineCheckSchema,
  projectPipelineListSchema,
  projectPipelineSchema,
  stageRunCommandOutputsSchema,
  standInChoicesResponseSchema,
  standInSwitchResponseSchema,
  stagesCheckSchema,
  stageTemplateApplyResultSchema,
  stageTemplateListSchema,
  stageTemplateSchema,
  taskStagesSchema,
  type DropReason,
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
  type StagePosition,
  type LinkedStageRef,
  type StageTemplate,
  type StageTemplateApplyResult,
  type StageTemplateCheckRequest,
  type StandInSwitchResult,
  type TaskStages,
} from "@the-office/contracts";
import { callOfficeAction, deleteFromApi, getFromApi, sendToApi } from "./api-client.ts";
import { OFF_BOARD_TASKS } from "./off-board-tasks.ts";
import { ENGINE_CASCADE, taskEngineCascadeKey } from "./people.ts";
import { taskChangesKey } from "./projects.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";
import { PIPELINES_KEY, PROJECT_PIPELINES_KEY, STAGE_TEMPLATES_KEY } from "./pipeline-keys.ts";

/** Apart from the Task's key, or the walk's and Work's events would read a run's whole output again. */
const COMMAND_OUTPUTS_KEY: readonly unknown[] = ["stage-run-command-outputs"];

const STAND_IN_CHOICES_KEY: readonly unknown[] = ["stand-in-choices"];

/** Under the templates', and stale too on any change to a Pipeline, whose Stages they are. */
const LINKED_STAGES_KEY: readonly unknown[] = [...STAGE_TEMPLATES_KEY, "linked-stages"];

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
      queryFn: ({ signal }) =>
        sendToApi("POST", "/pipelines/check", request, pipelineCheckSchema, signal),
    }),
  /**
   * The library Pipelines flagged "Needs fixing", checked in one request for the whole list rather
   * than one per row. Among the checks, so a change in who fills a Role reads it again too.
   */
  needingFixing: () =>
    queryOptions({
      queryKey: [...PIPELINES_KEY, "check", "needs-fixing"],
      queryFn: async ({ signal }) =>
        new Set(
          (
            await getFromApi(
              "/pipelines/library/needs-fixing",
              pipelinesNeedingFixingSchema,
              signal,
            )
          ).pipelineIds,
        ),
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
      queryFn: ({ signal }) =>
        sendToApi(
          "POST",
          `${stagesPath(taskId)}/check`,
          { stages, pipelineId },
          stagesCheckSchema,
          signal,
        ),
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
  /** The Project's Project Pipelines, each a full Pipeline of its own. */
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
  /** The Project's own Pipelines flagged "Needs fixing", in one request rather than one per row. */
  needingFixing: (projectId: string) =>
    queryOptions({
      queryKey: [...PROJECT_PIPELINES_KEY, "check", "needs-fixing", { projectId }],
      queryFn: async ({ signal }) =>
        new Set(
          (
            await getFromApi(
              `/project-pipelines/check/needs-fixing?projectId=${encodeURIComponent(projectId)}`,
              pipelinesNeedingFixingSchema,
              signal,
            )
          ).pipelineIds,
        ),
    }),
  /** What saving the edit would be refused for and only warned about. */
  check: (request: ProjectPipelineCheckRequest) =>
    queryOptions({
      queryKey: [...PROJECT_PIPELINES_KEY, "check", request],
      queryFn: ({ signal }) =>
        sendToApi("POST", "/project-pipelines/check", request, projectPipelineCheckSchema, signal),
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
      queryFn: ({ signal }) =>
        sendToApi("POST", "/stage-templates/check", request, pipelineCheckSchema, signal),
    }),
  /** The Stages of office-wide and Project Pipelines linked to the template. */
  linkedStages: (stageTemplateId: string) =>
    queryOptions({
      queryKey: [...LINKED_STAGES_KEY, stageTemplateId],
      queryFn: ({ signal }) =>
        getFromApi(
          `${stageTemplatePath(stageTemplateId)}/linked-stages`,
          linkedStageListSchema,
          signal,
        ),
    }),
};

/**
 * Reads the library's list again after the user's own change to it, and only the list, so what
 * follows the change waits for nothing else; the change's event refreshes the rest, checks too.
 */
export function refreshPipelineList(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: PIPELINES_KEY, exact: true });
}

/** As refreshPipelineList, for the Stage templates' list. */
export function refreshStageTemplateList(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: STAGE_TEMPLATES_KEY, exact: true });
}

/** A Pipeline made from scratch in the library. */
export function addPipeline(edit: PipelineEdit): Promise<Pipeline> {
  return sendToApi("POST", "/pipelines", edit, pipelineSchema);
}

/** A copy of a library Pipeline, named "… (copy)". */
export function duplicatePipeline(pipelineId: string): Promise<Pipeline> {
  return sendToApi("POST", "/pipelines/copies", { copyOf: pipelineId }, pipelineSchema);
}

/** The library Pipeline saved: Tasks that haven't started follow it; running ones keep their copy. */
export function savePipeline(pipelineId: string, edit: PipelineEdit): Promise<Pipeline> {
  return sendToApi("PUT", pipelinePath(pipelineId), edit, pipelineSchema);
}

export function removePipeline(pipelineId: string): Promise<void> {
  return deleteFromApi(pipelinePath(pipelineId));
}

/**
 * A Project Pipeline of the Project, a copy of an office-wide Pipeline (never Onboard) or of one of
 * the Project's own.
 */
export function addProjectPipeline(
  newProjectPipeline: NewProjectPipeline,
): Promise<ProjectPipeline> {
  return callOfficeAction(CREATE_PROJECT_PIPELINE_ACTION, newProjectPipeline);
}

/** The Project Pipeline saved; saving one Broken before The Office updated clears its flag. */
export function saveProjectPipeline(
  projectPipelineId: string,
  edit: ProjectPipelineEdit,
): Promise<ProjectPipeline> {
  return callOfficeAction(CHANGE_PROJECT_PIPELINE_ACTION, {
    pipelineId: projectPipelineId,
    ...edit,
  });
}

export function removeProjectPipeline(projectPipelineId: string): Promise<void> {
  return callOfficeAction(DELETE_PROJECT_PIPELINE_ACTION, { pipelineId: projectPipelineId });
}

/** A Stage template made from scratch, or a Stage saved as one; its failure rule is dropped. */
export function addStageTemplate(stage: Stage): Promise<StageTemplate> {
  return sendToApi("POST", "/stage-templates", { stage }, stageTemplateSchema);
}

/**
 * The template saved: its linked Stages keep their fields until the user applies the edit to them
 * (`applyStageTemplateEdit`); Tasks' Stages are copies and never change.
 */
export function saveStageTemplate(stageTemplateId: string, stage: Stage): Promise<StageTemplate> {
  return sendToApi("PUT", stageTemplatePath(stageTemplateId), { stage }, stageTemplateSchema);
}

/** Removing a template unlinks its linked Stages, which keep their fields; it is never refused. */
export function removeStageTemplate(stageTemplateId: string): Promise<void> {
  return deleteFromApi(stageTemplatePath(stageTemplateId));
}

/**
 * Gives the chosen linked Stages the template's named fields, each Pipeline saved under its own
 * checks; answers how many got them and each Pipeline refused, with why.
 */
export function applyStageTemplateEdit(
  stageTemplateId: string,
  fields: readonly string[],
  stages: readonly LinkedStageRef[],
): Promise<StageTemplateApplyResult> {
  return sendToApi(
    "POST",
    `${stageTemplatePath(stageTemplateId)}/apply`,
    { fields, stages },
    stageTemplateApplyResultSchema,
  );
}

/** Edit for this Task: the Task's Stages replaced, the library Pipeline left as it is. */
/** The Task's own Stages as edited for it, and where its End stands, if it was moved. */
export function editTaskStages(
  taskId: string,
  stages: readonly Stage[],
  endPosition?: StagePosition,
): Promise<TaskStages> {
  return sendToApi(
    "PUT",
    stagesPath(taskId),
    { stages, ...(endPosition && { endPosition }) },
    taskStagesSchema,
  );
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

export function dropAtGate(taskId: string, reason?: DropReason): Promise<TaskStages> {
  return sendToApi("POST", `${gatePath(taskId)}/drop`, reason ? { reason } : {}, taskStagesSchema);
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

/**
 * A change to the library, or to a Project Pipeline, makes every list of both stale, and the
 * templates' linked Stages.
 */
function staleLibrary(): readonly (readonly unknown[])[] {
  return [PIPELINES_KEY, LINKED_STAGES_KEY];
}

/** A change to a Stage template makes every list of them stale. */
function staleStageTemplates(): readonly (readonly unknown[])[] {
  return [STAGE_TEMPLATES_KEY];
}

/**
 * Each of the walk's events makes the Stages of the Task it names stale, and the Projects'
 * Off-board Tasks, whose cards show the current Stage and who works it. An event this page can't
 * read, as after an Office update, makes every Task's stale.
 */
function staleTaskStages(event: unknown): readonly (readonly unknown[])[] {
  const taskId = taskIdOf(event);
  return [taskId === undefined ? EVERY_TASK : taskStagesKey(taskId), OFF_BOARD_TASKS];
}

/** A change of a Task's Stages changes the Roles they name, so what each runs on for the Task too. */
function staleTaskStagesAndRoles(event: unknown): readonly (readonly unknown[])[] {
  const taskId = taskIdOf(event);
  return [
    ...staleTaskStages(event),
    taskId === undefined ? ENGINE_CASCADE : taskEngineCascadeKey(taskId),
  ];
}

/**
 * A run's end also makes the Task's Changes stale, as The Office commits the Stage's work then, and
 * its commands' outputs, saved then.
 */
function staleTaskStagesAndChanges(event: unknown): readonly (readonly unknown[])[] {
  const taskId = taskIdOf(event);
  if (taskId === undefined) return [EVERY_TASK, COMMAND_OUTPUTS_KEY];
  return [
    taskStagesKey(taskId),
    taskChangesKey(taskId),
    commandOutputsKey(taskId),
    OFF_BOARD_TASKS,
  ];
}

/** The Stages waiting for the user's choice of a Stand-in Engine changed. */
function staleStandInChoices(): readonly (readonly unknown[])[] {
  return [STAND_IN_CHOICES_KEY];
}

/** Every Task's queries, its Stages and Changes among them. */
const EVERY_TASK: readonly unknown[] = ["tasks"];

/** The Task the event names; undefined when this page can't read it, as after an Office update. */
function taskIdOf(event: unknown): string | undefined {
  const parsed = pipelinesWebEventSchema.safeParse(event);
  if (!parsed.success) return undefined;
  if (!("taskId" in parsed.data)) throw new Error(`A ${parsed.data.type} event names no Task.`);
  return parsed.data.taskId;
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
  "task-stages.made": staleTaskStagesAndRoles,
  "task-stages.edited": staleTaskStagesAndRoles,
  "task-stages.reset": staleTaskStagesAndRoles,
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

import { queryOptions } from "@tanstack/react-query";
import {
  pipelineListSchema,
  pipelinesWebEventSchema,
  taskStagesSchema,
  type PipelinesWebEvent,
} from "@the-office/contracts";
import { getFromApi } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

export const pipelineQueries = {
  // The library holds only the built-ins in tier 1, so it never changes while the service runs.
  list: () =>
    queryOptions({
      queryKey: ["pipelines"],
      queryFn: ({ signal }) => getFromApi("/pipelines", pipelineListSchema, signal),
      staleTime: Number.POSITIVE_INFINITY,
    }),
  /** Under the Task's key, so Work's events about the Task refresh it too. */
  taskStages: (taskId: string) =>
    queryOptions({
      queryKey: taskStagesKey(taskId),
      queryFn: ({ signal }) =>
        getFromApi(`/tasks/${encodeURIComponent(taskId)}/stages`, taskStagesSchema, signal),
    }),
};

function taskStagesKey(taskId: string): readonly unknown[] {
  return ["tasks", taskId, "stages"];
}

/** Each Pipelines event makes the Stages of the Task it names stale. */
function staleTaskStages(event: unknown): readonly (readonly unknown[])[] {
  return [taskStagesKey(pipelinesWebEventSchema.parse(event).taskId)];
}

export const pipelineEventInvalidations: Readonly<
  Record<PipelinesWebEvent["type"], EventInvalidations[string]>
> = {
  "task-stages.made": staleTaskStages,
  "stage-run.started": staleTaskStages,
  "stage-run.ended": staleTaskStages,
  "stage-run.skipped": staleTaskStages,
  "stage-run.went-back": staleTaskStages,
  "stage-run.budget-reached": staleTaskStages,
  "stage-run.no-retries-left": staleTaskStages,
  "pipeline.definition-of-done-not-met": staleTaskStages,
  "pipeline.completed": staleTaskStages,
};

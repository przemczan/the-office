import { queryOptions } from "@tanstack/react-query";
import {
  actionRunLogSchema,
  actionRunSchema,
  actionRunSourceTipSchema,
  actionRunWebEventSchema,
  actionSettingsSchema,
  projectActionRunsSchema,
  type ActionRun,
  type ActionRunLog,
  type ActionRunSourceQuery,
  type ActionRunStart,
  type ActionRunWebEvent,
  type ActionSettings,
} from "@the-office/contracts";
import { getFromApi, sendToApi } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const ACTION_RUNS = ["action-runs"] as const;
const SETTINGS = ["settings", "actions"] as const;

function projectPath(projectId: string): `/${string}` {
  return `/projects/${encodeURIComponent(projectId)}/actions`;
}

/** The query string a source is read by: `kind=branch&branch=…`, `kind=task&taskId=…`, … */
function sourceSearchOf(source: ActionRunSourceQuery): string {
  const search = new URLSearchParams({ kind: source.kind });
  if (source.kind === "branch") search.set("branch", source.branch);
  if (source.kind === "task") search.set("taskId", source.taskId);
  if (source.kind === "initiative") search.set("initiativeId", source.initiativeId);
  return search.toString();
}

export const actionRunQueries = {
  /** Each of the Project's Actions' runs, newest first; an Action's last run is its first. */
  ofProject: (projectId: string) =>
    queryOptions({
      queryKey: [...ACTION_RUNS, "project", projectId],
      queryFn: ({ signal }) =>
        getFromApi(`${projectPath(projectId)}/runs`, projectActionRunsSchema, signal),
    }),
  /**
   * What a start from the source would run, its branch's fetched tip and subject, as the Run
   * window shows it; never kept, so each opening reads the branch again.
   */
  sourceTip: (projectId: string, source: ActionRunSourceQuery) =>
    queryOptions({
      queryKey: [...ACTION_RUNS, "source", projectId, source],
      queryFn: ({ signal }) =>
        getFromApi(
          `${projectPath(projectId)}/source?${sourceSearchOf(source)}`,
          actionRunSourceTipSchema,
          signal,
        ),
      staleTime: 0,
      gcTime: 0,
      retry: false,
    }),
  /** Settings › Office limits' Actions card: Actions at once. */
  settings: () =>
    queryOptions({
      queryKey: SETTINGS,
      queryFn: ({ signal }) => getFromApi("/settings/actions", actionSettingsSchema, signal),
    }),
};

/** Starts the Action on what was chosen; it answers the new run. */
export function startActionRun(
  projectId: string,
  actionKey: string,
  start: ActionRunStart,
): Promise<ActionRun> {
  return sendToApi(
    "POST",
    `${projectPath(projectId)}/${encodeURIComponent(actionKey)}/runs`,
    start,
    actionRunSchema,
  );
}

/** Stops a Project command run, or a Test target run's test instance. */
export function stopActionRun(runId: string): Promise<ActionRun> {
  return sendToApi("POST", `/action-runs/${runId}/stop`, {}, actionRunSchema);
}

/** The masked log from byte `from` on, with the offset to read on from and the run's state. */
export function readActionRunLog(
  runId: string,
  from: number,
  signal?: AbortSignal,
): Promise<ActionRunLog> {
  return getFromApi(`/action-runs/${runId}/log?from=${from}`, actionRunLogSchema, signal);
}

export function changeActionSettings(settings: ActionSettings): Promise<ActionSettings> {
  return sendToApi("PUT", "/settings/actions", settings, actionSettingsSchema);
}

/** The event type the log window also hears, to read on at once. */
export const ACTION_RUN_CHANGED = "action-run.changed";

export const actionRunEventInvalidations: Readonly<
  Record<ActionRunWebEvent["type"], EventInvalidations[string]>
> = {
  [ACTION_RUN_CHANGED]: (event) => {
    const parsed = actionRunWebEventSchema.parse(event);
    if (parsed.type !== ACTION_RUN_CHANGED) return [ACTION_RUNS];
    return [actionRunQueries.ofProject(parsed.projectId).queryKey];
  },
  "action-settings.changed": () => [SETTINGS],
};

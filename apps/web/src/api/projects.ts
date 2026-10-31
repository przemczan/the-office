import { queryOptions } from "@tanstack/react-query";
import {
  environmentCheckSchema,
  latestEnvironmentCheckSchema,
  projectMcpServerValuesListSchema,
  projectMcpServerValuesSchema,
  projectListSchema,
  projectSchema,
  projectSkillListSchema,
  taskChangesSchema,
  type EnvironmentCheck,
  type NewProject,
  type Project,
  type ProjectEnvironment,
  type ProjectCommandKey,
  type ProjectMcpServerValues,
  type ProjectServerValuesChange,
  type ProjectWebEvent,
  type PublishingMode,
} from "@the-office/contracts";
import { getFromApi, sendToApi } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const PROJECTS = ["projects"] as const;

export const projectQueries = {
  list: () =>
    queryOptions({
      queryKey: PROJECTS,
      queryFn: ({ signal }) => getFromApi("/projects", projectListSchema, signal),
    }),
  one: (id: string) =>
    queryOptions({
      queryKey: [...PROJECTS, id],
      queryFn: ({ signal }) => getFromApi(projectPath(id), projectSchema, signal),
    }),
  /** The running environment check, or the last finished one. */
  environmentCheck: (id: string) =>
    queryOptions({
      queryKey: [...PROJECTS, id, "environment-check"],
      queryFn: ({ signal }) =>
        getFromApi(`${projectPath(id)}/environment-check`, latestEnvironmentCheckSchema, signal),
      select: ({ check }) => check,
    }),
  /** The repository's own skills and commands, read from its checkout. */
  skills: (id: string) =>
    queryOptions({
      queryKey: [...PROJECTS, id, "skills"],
      queryFn: ({ signal }) =>
        getFromApi(`${projectPath(id)}/skills`, projectSkillListSchema, signal),
    }),
  /**
   * Each MCP server's Server values with this Project's own. Under the Project's key, so the
   * library's events refresh it as they refresh the Projects.
   */
  serverValues: (id: string) =>
    queryOptions({
      queryKey: serverValuesKey(id),
      queryFn: ({ signal }) =>
        getFromApi(`${projectPath(id)}/server-values`, projectMcpServerValuesListSchema, signal),
    }),
  /** What the Task's commits changed in its Project, for the Changes tab. */
  taskChanges: (projectId: string, taskId: string) =>
    queryOptions({
      queryKey: taskChangesKey(taskId),
      queryFn: ({ signal }) =>
        getFromApi(
          `${projectPath(projectId)}/tasks/${encodeURIComponent(taskId)}/changes`,
          taskChangesSchema,
          signal,
        ),
    }),
};

/**
 * Under the Task's key, so Work's events about the Task refresh it too, and so does a Stage run's
 * end, after which The Office commits the Stage's work.
 */
export function taskChangesKey(taskId: string): readonly unknown[] {
  return ["tasks", taskId, "changes"];
}

export function addProject(newProject: NewProject): Promise<Project> {
  return sendToApi("POST", "/projects", newProject, projectSchema);
}

export function changeCommand(
  id: string,
  key: ProjectCommandKey,
  commandLine: string,
): Promise<Project> {
  return sendToApi("PUT", `${projectPath(id)}/commands/${key}`, { commandLine }, projectSchema);
}

export function changeInstallInputs(
  id: string,
  installInputs: readonly string[],
): Promise<Project> {
  return sendToApi("PUT", `${projectPath(id)}/install-inputs`, { installInputs }, projectSchema);
}

/** Starts a check of `environment`; the Project keeps it only when every check passes. */
export function startEnvironmentCheck(
  id: string,
  environment: ProjectEnvironment,
): Promise<EnvironmentCheck> {
  return sendToApi(
    "POST",
    `${projectPath(id)}/environment-check`,
    { environment },
    environmentCheckSchema,
  );
}

export function changePublishingMode(id: string, publishingMode: PublishingMode): Promise<Project> {
  return sendToApi("PUT", `${projectPath(id)}/publishing-mode`, { publishingMode }, projectSchema);
}

export function changeDefaultPipeline(id: string, defaultPipeline: string): Promise<Project> {
  return sendToApi(
    "PUT",
    `${projectPath(id)}/default-pipeline`,
    { defaultPipeline },
    projectSchema,
  );
}

/** Sessions started from now on get the repository's own skills, or don't. */
export function changeUseProjectSkills(id: string, useProjectSkills: boolean): Promise<Project> {
  return sendToApi(
    "PUT",
    `${projectPath(id)}/use-project-skills`,
    { useProjectSkills },
    projectSchema,
  );
}

/**
 * The Project's values for one MCP server: each value given is kept as given or, without a
 * `projectValue`, as kept; a value left out is cleared.
 */
export function changeProjectServerValues(
  id: string,
  serverName: string,
  change: ProjectServerValuesChange,
): Promise<ProjectMcpServerValues> {
  return sendToApi(
    "PUT",
    `${projectPath(id)}/server-values/${encodeURIComponent(serverName)}`,
    change,
    projectMcpServerValuesSchema,
  );
}

function serverValuesKey(id: string) {
  return [...PROJECTS, id, "server-values"] as const;
}

/**
 * Every Project event makes the Projects stale; ["projects"] also covers each Project's own query.
 * Keyed by the contract's event types, so a type the service doesn't send can't be listed.
 */
export const projectEventInvalidations: Readonly<
  Record<ProjectWebEvent["type"], EventInvalidations[string]>
> = {
  "project.added": () => [PROJECTS],
  "project.command-changed": () => [PROJECTS],
  "project.environment-changed": () => [PROJECTS],
  "project.environment-check-changed": () => [PROJECTS],
  "project.install-inputs-changed": () => [PROJECTS],
  "project.publishing-mode-changed": () => [PROJECTS],
  "project.default-pipeline-changed": () => [PROJECTS],
  "project.use-project-skills-changed": () => [PROJECTS],
};

function projectPath(id: string): `/${string}` {
  return `/projects/${encodeURIComponent(id)}`;
}

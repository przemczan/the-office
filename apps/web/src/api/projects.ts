import { queryOptions } from "@tanstack/react-query";
import {
  projectListSchema,
  projectSchema,
  type NewProject,
  type Project,
  type ProjectCommandKey,
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
};

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

/**
 * Every Project event makes the Projects stale; ["projects"] also covers each Project's own query.
 * Keyed by the contract's event types, so a type the service doesn't send can't be listed.
 */
export const projectEventInvalidations: Readonly<
  Record<ProjectWebEvent["type"], EventInvalidations[string]>
> = {
  "project.added": () => [PROJECTS],
  "project.command-changed": () => [PROJECTS],
  "project.publishing-mode-changed": () => [PROJECTS],
  "project.default-pipeline-changed": () => [PROJECTS],
};

function projectPath(id: string): `/${string}` {
  return `/projects/${encodeURIComponent(id)}`;
}

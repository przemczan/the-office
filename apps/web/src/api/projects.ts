import { queryOptions } from "@tanstack/react-query";
import {
  API_PATH,
  baseBranchFetchSchema,
  baseBranchFolderSchema,
  environmentCheckSchema,
  latestEnvironmentCheckSchema,
  projectMcpServerValuesListSchema,
  projectMcpServerValuesSchema,
  projectListSchema,
  projectRemoteNeedsSchema,
  projectRunEnvironmentSchema,
  projectSchema,
  projectSkillListSchema,
  repositoryCloneSchema,
  repositoryCloneWebEventSchema,
  taskChangesSchema,
  type AddProject,
  type EngineModel,
  type EnvironmentCheck,
  type Mark,
  type Project,
  type ProjectEnvironmentEdit,
  type CommandChange,
  type InstallCommandChange,
  type BeforePublishingCommandChange,
  type AfterPublishingCommandChange,
  type ProjectCommand,
  type ProjectImageFromRepository,
  type ProjectImageKey,
  type ProjectImagePalette,
  type ProjectMcpServerValues,
  type ProjectRunEnvironment,
  type ProjectServerValuesChange,
  type ProjectWebEvent,
  type PublishingMode,
  type RepositoryClone,
  type RepositoryCloneStart,
  type RepositoryCloneWebEvent,
  type RunEnvironmentChange,
} from "@the-office/contracts";
import { deleteFromApiReturning, getFromApi, sendFileToApi, sendToApi } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";
import { ENGINE_CASCADE } from "./people.ts";

const PROJECTS = ["projects"] as const;
/** Apart from the Projects' key, since Sign in with GitHub changes it too. */
export const REMOTE_NEEDS = ["remote-needs"] as const;
/**
 * Apart from the Projects' key, since a Task's events change it too: its set-up Task, and the Done
 * that turns it On.
 */
export const RUN_ENVIRONMENTS = ["run-environments"] as const;
/** Apart from the Projects' key, so no event moves an open file browser to another commit. */
const BASE_BRANCH = ["base-branch"] as const;

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
  /** The Run environment setting, the definition on the base branch, and the set-up Task. */
  runEnvironment: (id: string) =>
    queryOptions({
      queryKey: [...RUN_ENVIRONMENTS, id],
      queryFn: ({ signal }) =>
        getFromApi(`${projectPath(id)}/run-environment`, projectRunEnvironmentSchema, signal),
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
  /**
   * Which part of the Office identity the base branch's remote needs and what of it is missing;
   * null when the base branch tracks no remote branch.
   */
  remoteNeeds: (id: string) =>
    queryOptions({
      queryKey: [...REMOTE_NEEDS, id],
      queryFn: ({ signal }) =>
        getFromApi(`${projectPath(id)}/remote-needs`, projectRemoteNeedsSchema, signal),
      select: ({ remoteNeeds }) => remoteNeeds,
    }),
  /** A repository cloned by its Repository URL before it is added: under way, cloned or failed. */
  repositoryClone: (cloneId: string) =>
    queryOptions({
      queryKey: repositoryCloneKey(cloneId),
      queryFn: ({ signal }) =>
        getFromApi(
          `/repositories/clones/${encodeURIComponent(cloneId)}`,
          repositoryCloneSchema,
          signal,
        ),
    }),
  /**
   * Fetches the base branch and answers the commit to read folders from: once per sitting, so never
   * refetched while it is in use and dropped as soon as it isn't, for the next sitting to fetch anew.
   */
  baseBranchFetch: (id: string) =>
    queryOptions({
      queryKey: [...BASE_BRANCH, id, "fetch"],
      queryFn: () =>
        sendToApi("POST", `${projectPath(id)}/base-branch/fetch`, {}, baseBranchFetchSchema),
      staleTime: Infinity,
      gcTime: 0,
    }),
  /** One folder of a commit, which never changes, so read once. */
  baseBranchFolder: (id: string, commit: string, path: string, extensions: readonly string[]) =>
    queryOptions({
      queryKey: [...BASE_BRANCH, id, commit, path, extensions],
      queryFn: ({ signal }) => {
        const query = new URLSearchParams({ path, extensions: extensions.join(",") });
        return getFromApi(
          `${projectPath(id)}/base-branch/${encodeURIComponent(commit)}/folder?${query.toString()}`,
          baseBranchFolderSchema,
          signal,
        );
      },
      staleTime: Infinity,
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

export function addProject(request: AddProject): Promise<Project> {
  return sendToApi("POST", "/projects", request, projectSchema);
}

/** Starts cloning the repository at `url`; it is added as a Project by its clone's path after. */
export function startRepositoryClone(url: string): Promise<RepositoryClone> {
  const start: RepositoryCloneStart = { url };
  return sendToApi("POST", "/repositories/clones", start, repositoryCloneSchema);
}

export function changeInstallCommand(id: string, commandLine: string): Promise<Project> {
  const change: InstallCommandChange = { commandLine };
  return sendToApi("PUT", `${projectPath(id)}/install-command`, change, projectSchema);
}

/** The line run before Publish ships anything; blank clears it. */
export function changeBeforePublishingCommand(id: string, commandLine: string): Promise<Project> {
  const change: BeforePublishingCommandChange = { commandLine };
  return sendToApi("PUT", `${projectPath(id)}/before-publishing-command`, change, projectSchema);
}

/** The line run once Publish opened a pull request or merged; blank clears it. */
export function changeAfterPublishingCommand(id: string, commandLine: string): Promise<Project> {
  const change: AfterPublishingCommandChange = { commandLine };
  return sendToApi("PUT", `${projectPath(id)}/after-publishing-command`, change, projectSchema);
}

export function addCommand(id: string, command: ProjectCommand): Promise<Project> {
  return sendToApi("POST", `${projectPath(id)}/commands`, command, projectSchema);
}

/** The command's name, kind and command line; its key stays. */
export function changeCommand(id: string, key: string, change: CommandChange): Promise<Project> {
  return sendToApi("PUT", commandPath(id, key), change, projectSchema);
}

export function removeCommand(id: string, key: string): Promise<Project> {
  return deleteFromApiReturning(commandPath(id, key), projectSchema);
}

function commandPath(id: string, key: string): `/${string}` {
  return `${projectPath(id)}/commands/${encodeURIComponent(key)}`;
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
  environment: ProjectEnvironmentEdit,
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

export function changeRunEnvironment(
  id: string,
  runEnvironment: RunEnvironmentChange["runEnvironment"],
): Promise<ProjectRunEnvironment> {
  return sendToApi(
    "PUT",
    `${projectPath(id)}/run-environment`,
    { runEnvironment },
    projectRunEnvironmentSchema,
  );
}

/** Turns On at once with a valid definition on the base branch, else adds the set-up Task. */
export function setUpRunEnvironment(id: string): Promise<ProjectRunEnvironment> {
  return sendToApi(
    "POST",
    `${projectPath(id)}/run-environment/set-up`,
    {},
    projectRunEnvironmentSchema,
  );
}

export function changeMark(id: string, mark: Mark): Promise<Project> {
  return sendToApi("PUT", `${projectPath(id)}/mark`, { mark }, projectSchema);
}

/** How many of the Project's Tasks may be started at once; lowering it stops none. */
export function changeProjectLimit(id: string, projectLimit: number): Promise<Project> {
  return sendToApi("PUT", `${projectPath(id)}/project-limit`, { projectLimit }, projectSchema);
}

/** One version of the Project's Icon or Logo: the image, and the palette it is for. */
export interface ProjectImageVersion {
  readonly key: ProjectImageKey;
  readonly palette: ProjectImagePalette;
}

function versionPath(id: string, { key, palette }: ProjectImageVersion): `/${string}` {
  return `${projectPath(id)}/images/${key}/${palette}`;
}

/** Replaces that version of the Project's Icon or Logo, or gives it one. */
export function uploadProjectImage(
  id: string,
  version: ProjectImageVersion,
  file: File,
): Promise<Project> {
  return sendFileToApi(versionPath(id, version), file, projectSchema);
}

/** As an upload, with a copy of the file in the Project's repository at the commit given. */
export function chooseProjectImage(
  id: string,
  version: ProjectImageVersion,
  file: ProjectImageFromRepository,
): Promise<Project> {
  return sendToApi("POST", `${versionPath(id, version)}/from-repository`, file, projectSchema);
}

export function removeProjectImage(id: string, version: ProjectImageVersion): Promise<Project> {
  return deleteFromApiReturning(versionPath(id, version), projectSchema);
}

/** Where an Icon or a Logo is read from; a new upload has a new address, so none goes stale. */
export function projectImageAddress(id: string, imageId: string): string {
  return `${API_PATH}${projectPath(id)}/images/${encodeURIComponent(imageId)}/content`;
}

export function changeDefaultPipeline(id: string, defaultPipeline: string): Promise<Project> {
  return sendToApi(
    "PUT",
    `${projectPath(id)}/default-pipeline`,
    { defaultPipeline },
    projectSchema,
  );
}

/** The engine and model every Role in the Project runs on unless a more specific level wins; null clears it. */
export function changeProjectDefault(
  id: string,
  projectDefault: EngineModel | null,
): Promise<Project> {
  return sendToApi("PUT", `${projectPath(id)}/project-default`, { projectDefault }, projectSchema);
}

/** The Project default wins over the Office-wide Role overrides, or doesn't. */
export function changeUseForEveryRole(id: string, useForEveryRole: boolean): Promise<Project> {
  return sendToApi(
    "PUT",
    `${projectPath(id)}/use-for-every-role`,
    { useForEveryRole },
    projectSchema,
  );
}

/** The engine and model one Role runs on in the Project; null removes the override. */
export function changeRoleOverride(
  id: string,
  roleKey: string,
  roleOverride: EngineModel | null,
): Promise<Project> {
  return sendToApi(
    "PUT",
    `${projectPath(id)}/role-overrides/${encodeURIComponent(roleKey)}`,
    { roleOverride },
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

/** Sessions started from now on get the repository's skill of this key, or start without it. */
export function changeProjectSkillUse(id: string, key: string, use: boolean): Promise<Project> {
  return sendToApi("PUT", `${projectPath(id)}/skill-use`, { key, use }, projectSchema);
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

/** Outside ["projects"]: a clone is no Project yet, and Project events don't change it. */
function repositoryCloneKey(cloneId: string) {
  return ["repository-clones", cloneId] as const;
}

/**
 * Every Project event makes the Projects stale; ["projects"] also covers each Project's own query.
 * Keyed by the contract's event types, so a type the service doesn't send can't be listed.
 */
export const projectEventInvalidations: Readonly<
  Record<ProjectWebEvent["type"], EventInvalidations[string]>
> = {
  "project.added": () => [PROJECTS],
  "project.install-command-changed": () => [PROJECTS],
  "project.before-publishing-command-changed": () => [PROJECTS],
  "project.after-publishing-command-changed": () => [PROJECTS],
  "project.command-added": () => [PROJECTS],
  "project.command-changed": () => [PROJECTS],
  "project.command-removed": () => [PROJECTS],
  "project.environment-changed": () => [PROJECTS],
  "project.environment-check-changed": () => [PROJECTS],
  "project.install-inputs-changed": () => [PROJECTS],
  "project.publishing-mode-changed": () => [PROJECTS],
  "project.run-environment-changed": () => [PROJECTS, RUN_ENVIRONMENTS],
  "project.project-limit-changed": () => [PROJECTS],
  "project.mark-changed": () => [PROJECTS],
  "project.image-changed": () => [PROJECTS],
  "project.default-pipeline-changed": () => [PROJECTS],
  "project.use-project-skills-changed": () => [PROJECTS],
  "project.skill-use-changed": () => [PROJECTS],
  "project.project-default-changed": () => [PROJECTS, ENGINE_CASCADE],
  "project.use-for-every-role-changed": () => [PROJECTS, ENGINE_CASCADE],
  "project.role-override-changed": () => [PROJECTS, ENGINE_CASCADE],
};

/** A clone that started, moved on or finished is read again by its id. */
export const repositoryCloneEventInvalidations: Readonly<
  Record<RepositoryCloneWebEvent["type"], EventInvalidations[string]>
> = {
  "repository-clone.changed": (event) => [
    repositoryCloneKey(repositoryCloneWebEventSchema.parse(event).cloneId),
  ],
};

function projectPath(id: string): `/${string}` {
  return `/projects/${encodeURIComponent(id)}`;
}

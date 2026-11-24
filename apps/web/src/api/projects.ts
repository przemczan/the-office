import { queryOptions } from "@tanstack/react-query";
import {
  API_PATH,
  baseBranchFetchSchema,
  issueImportResultSchema,
  issueLinkSchema,
  openIssueListSchema,
  environmentCheckSchema,
  latestEnvironmentCheckSchema,
  projectMcpServerValuesListSchema,
  projectMcpServerValuesSchema,
  projectBranchesSchema,
  projectListSchema,
  projectRemoteNeedsSchema,
  projectRunEnvironmentSchema,
  projectSchema,
  projectSettingChangesSchema,
  projectSkillListSchema,
  repositoryCloneSchema,
  repositoryCloneWebEventSchema,
  repositoryFilePreviewSchema,
  repositoryFolderSchema,
  taskChangesSchema,
  projectTestTargetsChatSchema,
  runEnvironmentSetUpAnswerSchema,
  testTargetListSchema,
  type AddProject,
  type ProjectEngineChange,
  type EnvironmentCheck,
  type Mark,
  type Project,
  type ProjectEnvironmentEdit,
  type ProjectFeaturesChange,
  type CommandChange,
  type InstallCommandChange,
  type IssueImportResult,
  type IssueSettings,
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
  type TaskKind,
  type TestTargetList,
  type ProjectTestTargetsChat,
  type RunEnvironmentSetUpAnswer,
  type TestTargetsEdit,
} from "@the-office/contracts";
import { deleteFromApiReturning, getFromApi, sendFileToApi, sendToApi } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";
import { ENGINE_CASCADE } from "./people.ts";

const PROJECTS = ["projects"] as const;
/** Each Task's issue link (GET /issue-links?taskId=), apart from the Projects' key. */
export const ISSUE_LINKS = ["issue-links"] as const;
/**
 * Each Project's open issues not yet imported, read from GitHub: apart from the Projects' key, so
 * the Project's every event doesn't list them again.
 */
export const OPEN_ISSUES = ["open-issues"] as const;
/** Apart from the Projects' key, since Sign in with GitHub changes it too. */
export const REMOTE_NEEDS = ["remote-needs"] as const;
/**
 * Apart from the Projects' key, since a Task's events change it too: its set-up Task, and the Done
 * that turns it On.
 */
export const RUN_ENVIRONMENTS = ["run-environments"] as const;
/**
 * Apart from the Projects' key, since a Task's events change it: the test targets chat and an
 * open set-up Task made before.
 */
export const TEST_TARGETS_SET_UPS = ["test-targets-set-ups"] as const;
/**
 * Apart from the Projects' key, so no event moves an open file browser to another commit; what a
 * commit holds never changes.
 */
const REPOSITORY = ["repository"] as const;

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
  /** The open issues not yet imported, newest first; refused (422) off GitHub or signed out. */
  openIssues: (id: string) =>
    queryOptions({
      queryKey: [...OPEN_ISSUES, id],
      queryFn: ({ signal }) => getFromApi(`${projectPath(id)}/issues`, openIssueListSchema, signal),
    }),
  /** The GitHub issue a Task was imported from, or null; `issue-link.changed` reads it again. */
  issueLink: (taskId: string) =>
    queryOptions({
      queryKey: [...ISSUE_LINKS, taskId],
      queryFn: ({ signal }) =>
        getFromApi(
          `/issue-links?${new URLSearchParams({ taskId }).toString()}`,
          issueLinkSchema.nullable(),
          signal,
        ),
    }),
  /** The Run environment setting, the definition on the base branch, and the set-up Task. */
  runEnvironment: (id: string) =>
    queryOptions({
      queryKey: [...RUN_ENVIRONMENTS, id],
      queryFn: ({ signal }) =>
        getFromApi(`${projectPath(id)}/run-environment`, projectRunEnvironmentSchema, signal),
    }),
  /**
   * The Project's latest recorded setting changes, newest first, for its Recent activity; under
   * the Projects' key, so each setting's event reads them again.
   */
  settingChanges: (id: string) =>
    queryOptions({
      queryKey: [...PROJECTS, id, "setting-changes"],
      queryFn: ({ signal }) =>
        getFromApi(`${projectPath(id)}/setting-changes`, projectSettingChangesSchema, signal),
      select: ({ changes }) => changes,
    }),
  /** The running environment check, or the last finished one. */
  environmentCheck: (id: string) =>
    queryOptions({
      queryKey: [...PROJECTS, id, "environment-check"],
      queryFn: ({ signal }) =>
        getFromApi(`${projectPath(id)}/environment-check`, latestEnvironmentCheckSchema, signal),
      select: ({ check }) => check,
    }),
  /** The Project's test targets, in the order added, each Secret variable by name alone. */
  testTargets: (id: string) =>
    queryOptions({
      queryKey: testTargetsKey(id),
      queryFn: ({ signal }) =>
        getFromApi(`${projectPath(id)}/test-targets`, testTargetListSchema, signal),
    }),
  /**
   * The test targets chat the card follows, and an open "Set up test targets" Task made before;
   * read again by Task events, and by the followed Thread's (`TestTargetsBlock` hears them).
   */
  testTargetsChat: (id: string) =>
    queryOptions({
      queryKey: [...TEST_TARGETS_SET_UPS, id],
      queryFn: ({ signal }) =>
        getFromApi(`${projectPath(id)}/test-targets/chat`, projectTestTargetsChatSchema, signal),
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
      queryKey: [...REPOSITORY, id, "fetch"],
      queryFn: () =>
        sendToApi("POST", `${projectPath(id)}/base-branch/fetch`, {}, baseBranchFetchSchema),
      staleTime: Infinity,
      gcTime: 0,
    }),
  /**
   * The branches whose files can be browsed. Fetched, the base branch's remote is fetched first,
   * once per sitting as `baseBranchFetch` is; unfetched, only what is known here, as a page asking
   * whether a branch exists does, under the Project's key so its events read it again.
   */
  branches: (id: string, { fetch }: { readonly fetch: boolean }) =>
    queryOptions({
      queryKey: fetch ? [...REPOSITORY, id, "branches"] : [...PROJECTS, id, "branches"],
      queryFn: ({ signal }) =>
        getFromApi(
          `${projectPath(id)}/branches${fetch ? "?fetch=1" : ""}`,
          projectBranchesSchema,
          signal,
        ),
      ...(fetch && { staleTime: Infinity, gcTime: 0 }),
    }),
  /** One folder of a commit, which never changes, so read once. */
  repositoryFolder: (id: string, commit: string, path: string, extensions: readonly string[]) =>
    queryOptions({
      queryKey: [...REPOSITORY, id, commit, "folder", path, extensions],
      queryFn: ({ signal }) => {
        const query = new URLSearchParams({ path, extensions: extensions.join(",") });
        return getFromApi(
          `${commitPath(id, commit)}/folder?${query.toString()}`,
          repositoryFolderSchema,
          signal,
        );
      },
      staleTime: Infinity,
    }),
  /** How one file of a commit shows, read once like its folder. */
  filePreview: (id: string, commit: string, path: string) =>
    queryOptions({
      queryKey: [...REPOSITORY, id, commit, "file-preview", path],
      queryFn: ({ signal }) =>
        getFromApi(
          `${commitPath(id, commit)}/file-preview?${new URLSearchParams({ path }).toString()}`,
          repositoryFilePreviewSchema,
          signal,
        ),
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

/** The command's name, kind, command line and re-run command; its key stays. */
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

/** Saves the Project's environment as a whole; a Secret variable left without a value keeps its own. */
export function saveEnvironment(id: string, environment: ProjectEnvironmentEdit): Promise<Project> {
  return sendToApi("PUT", `${projectPath(id)}/environment`, { environment }, projectSchema);
}

/** Starts a check of the Project's saved environment, which changes nothing. */
export function startEnvironmentCheck(id: string): Promise<EnvironmentCheck> {
  return sendToApi("POST", `${projectPath(id)}/environment-check`, {}, environmentCheckSchema);
}

export function changePublishingMode(id: string, publishingMode: PublishingMode): Promise<Project> {
  return sendToApi("PUT", `${projectPath(id)}/publishing-mode`, { publishingMode }, projectSchema);
}

/** Turns Delete branches once merged on or off (spec §5.5, "Deleting merged branches"). */
export function changeDeleteMergedBranches(id: string, on: boolean): Promise<Project> {
  return sendToApi("PUT", `${projectPath(id)}/delete-merged-branches`, { on }, projectSchema);
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

/**
 * Turns On at once with a valid definition on the base branch (`start` null), else starts the
 * "Set up the run environment" Off-board Task at once, answers the one in flight, or is refused.
 */
export function setUpRunEnvironment(id: string): Promise<RunEnvironmentSetUpAnswer> {
  return sendToApi(
    "POST",
    `${projectPath(id)}/run-environment/set-up`,
    {},
    runEnvironmentSetUpAnswerSchema,
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

/** A Kind's own default Pipeline; null follows the Project's default Pipeline. */
export function changeKindDefaultPipeline(
  id: string,
  kind: TaskKind,
  pipelineId: string | null,
): Promise<Project> {
  return sendToApi(
    "PUT",
    `${projectPath(id)}/kind-default-pipeline`,
    { kind, pipelineId },
    projectSchema,
  );
}

/** The Project's GitHub issue switches, as a whole. */
export function changeIssueSettings(id: string, settings: IssueSettings): Promise<Project> {
  return sendToApi("PUT", `${projectPath(id)}/issue-settings`, settings, projectSchema);
}

/**
 * Switches the Project's features named on or off, the others kept; turning one on is refused
 * while a feature it needs is off, and turning one off turns off those that need it.
 */
export function changeFeatures(
  id: string,
  features: ProjectFeaturesChange["features"],
): Promise<Project> {
  return sendToApi("PUT", `${projectPath(id)}/features`, { features }, projectSchema);
}

/** Imports the issues as Tasks in Backlog; one imported meanwhile is skipped and named. */
export function importIssues(id: string, numbers: readonly number[]): Promise<IssueImportResult> {
  return sendToApi(
    "POST",
    `${projectPath(id)}/issues/import`,
    { numbers },
    issueImportResultSchema,
  );
}

/**
 * Changes the Project's levels of the engine cascades (spec §5.4.5): a field sent replaces that level,
 * a field left out keeps the Project's.
 */
export function changeProjectEngine(id: string, change: ProjectEngineChange): Promise<Project> {
  return sendToApi("PUT", `${projectPath(id)}/engine`, change, projectSchema);
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

/**
 * The Project's test targets, whole and in order: a target left out is removed, and a Secret
 * variable sent without a value keeps its own.
 */
export function saveTestTargets(id: string, edit: TestTargetsEdit): Promise<TestTargetList> {
  return sendToApi("PUT", `${projectPath(id)}/test-targets`, edit, testTargetListSchema);
}

/**
 * Ask, or Ask again: a new Thread in the chat of whoever onboards Projects, titled "Set up test
 * targets: <Project>", with no message sent, which the Test targets card follows from now on.
 * Refused (422) while nobody holds the duty, or while the followed chat's Proposal is open.
 */
export function askTestTargetsChat(id: string): Promise<ProjectTestTargetsChat> {
  return sendToApi(
    "POST",
    `${projectPath(id)}/test-targets/chat`,
    {},
    projectTestTargetsChatSchema,
  );
}

function testTargetsKey(id: string) {
  return [...PROJECTS, id, "test-targets"] as const;
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
  "project.delete-merged-branches-changed": () => [PROJECTS],
  "project.run-environment-changed": () => [PROJECTS, RUN_ENVIRONMENTS],
  "project.project-limit-changed": () => [PROJECTS],
  "project.mark-changed": () => [PROJECTS],
  "project.image-changed": () => [PROJECTS],
  "project.default-pipeline-changed": () => [PROJECTS],
  "project.use-project-skills-changed": () => [PROJECTS],
  "project.skill-use-changed": () => [PROJECTS],
  "project.engine-changed": () => [PROJECTS, ENGINE_CASCADE],
  "project.issue-settings-changed": () => [PROJECTS],
  "project.features-changed": () => [PROJECTS],
  "project.issues-imported": () => [PROJECTS, OPEN_ISSUES],
  "project.test-targets-changed": () => [PROJECTS],
  // The Project's Actions (actions.ts) are under its key.
  "project.actions-changed": () => [PROJECTS],
  "issue-link.changed": () => [ISSUE_LINKS],
};

/** A clone that started, moved on or finished is read again by its id. */
export const repositoryCloneEventInvalidations: Readonly<
  Record<RepositoryCloneWebEvent["type"], EventInvalidations[string]>
> = {
  "repository-clone.changed": (event) => [
    repositoryCloneKey(repositoryCloneWebEventSchema.parse(event).cloneId),
  ],
};

/**
 * Where a file of a commit is read from: shown in the browser as it is, or downloaded under its
 * own name.
 */
export function repositoryFileAddress(
  id: string,
  commit: string,
  path: string,
  { download }: { readonly download: boolean },
): string {
  const query = new URLSearchParams({ path, ...(download && { download: "1" }) });
  return `${API_PATH}${commitPath(id, commit)}/file?${query.toString()}`;
}

function projectPath(id: string): `/${string}` {
  return `/projects/${encodeURIComponent(id)}`;
}

function commitPath(id: string, commit: string): `/${string}` {
  return `${projectPath(id)}/commits/${encodeURIComponent(commit)}`;
}

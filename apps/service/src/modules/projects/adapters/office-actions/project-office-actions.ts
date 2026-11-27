import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import {
  CHANGE_AFTER_PUBLISHING_COMMAND_ACTION,
  CHANGE_BEFORE_PUBLISHING_COMMAND_ACTION,
  CHANGE_DEFAULT_PIPELINE_ACTION,
  CHANGE_DELETE_MERGED_BRANCHES_ACTION,
  CHANGE_ISSUE_SETTINGS_ACTION,
  CHANGE_PUBLISHING_MODE_ACTION,
  CHANGE_KIND_DEFAULT_PIPELINE_ACTION,
  CHANGE_PROJECT_ENGINE_ACTION,
  CHANGE_PROJECT_FEATURES_ACTION,
  CHANGE_PROJECT_LIMIT_ACTION,
  CHANGE_PROJECT_MARK_ACTION,
  CHANGE_PROJECT_SKILL_USE_ACTION,
  CHANGE_SERVER_VALUES_ACTION,
  CHANGE_USE_PROJECT_SKILLS_ACTION,
  CLOSE_PULL_REQUEST_ACTION,
  FETCH_BASE_BRANCH_ACTION,
  IMPORT_ISSUES_ACTION,
  PROJECT_OFFICE_ACTIONS,
  REMOVE_PROJECT_IMAGE_ACTION,
  RERUN_CI_RUN_ACTION,
  runEnvironmentSetUpAnswerSchema,
  SET_PROJECT_IMAGE_FROM_REPOSITORY_ACTION,
  SET_UP_RUN_ENVIRONMENT_ACTION,
  START_WORKFLOW_ACTION,
  type OfficeAction,
  type Project as ProjectResponse,
  type RunEnvironmentSetUpAnswer,
} from "@the-office/contracts";
import type { z } from "zod";
import type { SignedInUser } from "../../../../platform/http/signed-in-requests.js";
import {
  officeActionDraft,
  officeActionTool,
  OfficeToolRegistry,
  type OfficeTool,
  type OfficeToolRedactedInput,
  type OfficeToolResult,
  type OfficeToolUser,
} from "../../../engine/index.js";
import { McpServerRefused, ProjectServerValues } from "../../../mcp-servers/index.js";
import { CiRunWatch } from "../../application/ci-run-watch.js";
import { IssueImport } from "../../application/issue-import.js";
import { ProjectFeatures } from "../../application/project-features.js";
import { ProjectImages } from "../../application/project-images.js";
import { ProjectIssueHosts } from "../../application/project-issue-hosts.js";
import { ProjectService } from "../../application/project-service.js";
import { PullRequestActions } from "../../application/pull-request-actions.js";
import { RepositoryFiles } from "../../application/repository-files.js";
import { RunEnvironmentSetUpRegistry } from "../../application/run-environment-set-up-registry.js";
import { SessionPeople } from "../../application/session-people.js";
import { WorkflowStarts, type WorkflowStarted } from "../../application/workflow-starts.js";
import { byTheUser, type ActedBy } from "../../domain/acted-by.js";
import { ensureRerunnable, type CiRunJobs } from "../../domain/ci-run.js";
import type { IssueUser } from "../../domain/issue-settings.js";
import type { Project } from "../../domain/project.js";
import { ProjectNotFound } from "../../domain/project-not-found.js";
import { ProjectRefused } from "../../domain/project-refused.js";
import { PullRequestNotFound, PullRequestRefused } from "../../domain/pull-request-refused.js";
import type { PullRequest } from "../../domain/pull-request.js";
import { CodeHostRefused, type CiRunOnHost } from "../../ports/code-host.js";
import { ProjectRepository } from "../../ports/project-repository.js";
import { PullRequestRepository } from "../../ports/pull-request-repository.js";
import { toProjectResponse } from "../http/project-responses.js";
import { toProjectMcpServerValuesResponse } from "../http/project-server-values-responses.js";

/** The Authority group that rules a call giving a secret's value. */
const SECRET_VALUES_GROUP = "secretValues";

/**
 * Who asks an action of Projects: the signed-in user's own request, or an Agent's call (a Proposal
 * the user applied included). `actedBy` is who the actions that record it name: the user, the one
 * who applied the Proposal, or the person with the users behind their call.
 */
interface Caller {
  readonly asker: "user" | "agent";
  actedBy(): Promise<ActedBy>;
}

/**
 * One of Projects' Office actions as Projects carries it out: `handle` for the user's request and
 * the Agent's call alike, by `caller`, its result answered to the web by `response` and worded to
 * the Agent by `words`.
 */
interface ProjectActionHandler<Action extends OfficeAction, Result> {
  readonly action: Action;
  handle(input: z.output<Action["input"]>, caller: Caller): Promise<Result>;
  response(result: Result): z.input<Action["answer"]> | Promise<z.input<Action["answer"]>>;
  words(result: Result, input: z.output<Action["input"]>): string;
}

/** A handler with its action's types left behind, as the routes and tools look it up by name. */
type AnyProjectActionHandler = ProjectActionHandler<OfficeAction, unknown>;

function handler<Action extends OfficeAction, Result>(
  each: ProjectActionHandler<Action, Result>,
): AnyProjectActionHandler {
  return each as unknown as AnyProjectActionHandler;
}

/** A CI run that runs again, as the re-run answers it. */
interface Rerun {
  readonly project: Project;
  readonly run: CiRunOnHost;
  readonly jobs: CiRunJobs;
}

/**
 * Projects' Office actions (the Office action convention): the one handler of each action Projects
 * declares, which its route (`ProjectOfficeActionsController`) and its Office tool, registered
 * here, both call. Throws at start for a declared action with no handler.
 */
@Injectable()
export class ProjectOfficeActions implements OnModuleInit {
  private readonly logger = new Logger(ProjectOfficeActions.name);
  private readonly handlers: ReadonlyMap<string, AnyProjectActionHandler>;

  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly projects: ProjectRepository,
    private readonly ciRuns: CiRunWatch,
    private readonly workflowStarts: WorkflowStarts,
    private readonly projectService: ProjectService,
    private readonly features: ProjectFeatures,
    private readonly images: ProjectImages,
    private readonly issueHosts: ProjectIssueHosts,
    private readonly issueImport: IssueImport,
    private readonly files: RepositoryFiles,
    private readonly pullRequestActions: PullRequestActions,
    private readonly pullRequests: PullRequestRepository,
    private readonly serverValues: ProjectServerValues,
    private readonly runEnvironmentSetUp: RunEnvironmentSetUpRegistry,
    private readonly sessionPeople: SessionPeople,
  ) {
    this.handlers = new Map(
      [
        this.rerunCiRun(),
        this.startWorkflow(),
        this.changeProjectLimit(),
        this.changeProjectMark(),
        this.changeProjectFeatures(),
        this.changeUseProjectSkills(),
        this.changeProjectSkillUse(),
        this.setProjectImageFromRepository(),
        this.removeProjectImage(),
        this.changeProjectEngine(),
        this.changeDefaultPipeline(),
        this.changeKindDefaultPipeline(),
        this.changeServerValues(),
        this.changePublishingMode(),
        this.changeBeforePublishingCommand(),
        this.changeAfterPublishingCommand(),
        this.changeDeleteMergedBranches(),
        this.changeIssueSettings(),
        this.fetchBaseBranch(),
        this.importIssues(),
        this.closePullRequest(),
        this.setUpRunEnvironment(),
      ].map((each) => [each.action.name, each]),
    );
    const unhandled = PROJECT_OFFICE_ACTIONS.filter(({ name }) => !this.handlers.has(name));
    if (unhandled.length > 0) {
      throw new Error(`No handler carries out ${unhandled.map(({ name }) => name).join(", ")}.`);
    }
  }

  onModuleInit(): void {
    for (const each of this.handlers.values()) {
      const tool = officeActionTool(
        each.action,
        (input, { sessionId, allowedBy }) =>
          answered(async () => {
            const actedBy = () => this.personInSession(sessionId, allowedBy);
            return each.words(await each.handle(input, { asker: "agent", actedBy }), input);
          }),
        {
          draft: (input) => this.draftOf(each.action, input as Record<string, unknown>),
          applyFor: (input, { user }) => {
            const actedBy = () => Promise.resolve(byTheUser(user));
            return answered(async () =>
              each.words(await each.handle(input, { asker: "agent", actedBy }), input),
            );
          },
        },
      );
      this.registry.register(
        each.action.name === CHANGE_SERVER_VALUES_ACTION.name ? this.withSecrets(tool) : tool,
      );
    }
  }

  /** The route's answer to the action, carried out for the signed-in user. */
  async answer(action: OfficeAction, input: unknown, signedIn: SignedInUser): Promise<unknown> {
    const each = this.handlers.get(action.name);
    if (!each) throw new Error(`Projects carries out no Office action ${action.name}.`);
    const actedBy = () => Promise.resolve(byTheUser(signedIn));
    return each.response(await each.handle(input as never, { asker: "user", actedBy }));
  }

  /** The session's person, with the users behind the call; refused when nobody keeps the session. */
  private async personInSession(
    sessionId: string,
    allowedBy: OfficeToolUser | undefined,
  ): Promise<ActedBy> {
    const roleKey = await this.sessionPeople.personInSession(sessionId);
    if (roleKey === undefined) {
      throw new ProjectRefused(["The Office doesn't know whose session this is."]);
    }
    const taskId = await this.sessionPeople.taskInSession(sessionId);
    const askedBy = await this.sessionPeople.askedByInSession(sessionId);
    return {
      kind: "person",
      roleKey,
      ...(taskId !== undefined && { taskId }),
      ...(askedBy && { askedBy: { userId: askedBy.userId, name: askedBy.name } }),
      ...(allowedBy && { allowedBy: { userId: allowedBy.userId, name: allowedBy.name } }),
    };
  }

  /** What a call changes now: the Project, or the pull request, it acts on. */
  private async draftOf(action: OfficeAction, input: Record<string, unknown>) {
    const subject = action.subject(input);
    if (subject.kind === "pull-request") {
      const pullRequest = await this.pullRequests.findById(subject.id);
      if (pullRequest === undefined) throw new PullRequestNotFound(subject.id);
      return officeActionDraft(action, input as never, {
        title: `Pull request #${pullRequest.number}: ${pullRequest.title}`,
        decidedBy: { open: pullRequest.endedAt === null },
        values: {},
      });
    }
    const project = await this.projects.find(subject.id);
    if (project === undefined) throw new ProjectNotFound(subject.id);
    return officeActionDraft(action, input as never, {
      title: project.name,
      // What the handler reads of the Project to decide stays out: each call is checked as it runs.
      decidedBy: {},
      values: valuesOf(action, project),
    });
  }

  private rerunCiRun(): AnyProjectActionHandler {
    return handler({
      action: RERUN_CI_RUN_ACTION,
      handle: ({ projectId, runId, jobs }) => this.rerun(projectId, runId, jobs),
      response: ({ project, run, jobs }: Rerun) => ({ projectId: project.id, runId: run.id, jobs }),
      words: ({ project, run, jobs }) =>
        `CI run ${run.workflow} #${run.number} of "${project.name}" runs again, ${jobs === "all" ? "all its jobs" : "only its failed jobs"}.`,
    });
  }

  private startWorkflow(): AnyProjectActionHandler {
    return handler({
      action: START_WORKFLOW_ACTION,
      handle: ({ projectId, workflow, ref, inputs }) =>
        this.workflowStarts.byHand(projectId, workflow, ref, inputs),
      response: ({ project, workflow, ref }: WorkflowStarted) => ({
        projectId: project.id,
        workflow: workflow.id,
        ref,
      }),
      words: ({ project, workflow, ref }) =>
        `Workflow ${workflow.name} (${workflow.id}) of "${project.name}" starts on ${ref}; its run shows in Work › CI once the code host lists it.`,
    });
  }

  /** The Project as the API shows it, with its code host read from git's config. */
  private async respond(project: Project): Promise<ProjectResponse> {
    return toProjectResponse(project, await this.issueHosts.codeHostNameOf(project));
  }

  private changeProjectLimit(): AnyProjectActionHandler {
    return handler({
      action: CHANGE_PROJECT_LIMIT_ACTION,
      handle: ({ projectId, projectLimit }) =>
        this.projectService.changeProjectLimit(projectId, projectLimit),
      response: (project: Project) => this.respond(project),
      words: (project) =>
        `"${project.name}" starts at most ${project.projectLimit} Tasks at once now.`,
    });
  }

  private changeProjectMark(): AnyProjectActionHandler {
    return handler({
      action: CHANGE_PROJECT_MARK_ACTION,
      handle: ({ projectId, mark }) => this.projectService.changeMark(projectId, mark),
      response: (project: Project) => this.respond(project),
      words: (project) =>
        `"${project.name}" has the mark ${project.mark.label} in ${project.mark.colour} now.`,
    });
  }

  private changeProjectFeatures(): AnyProjectActionHandler {
    return handler({
      action: CHANGE_PROJECT_FEATURES_ACTION,
      handle: ({ projectId, features }) => this.features.change(projectId, features),
      response: (project: Project) => this.respond(project),
      words: (project) => `The features of "${project.name}" are changed as given.`,
    });
  }

  private changeUseProjectSkills(): AnyProjectActionHandler {
    return handler({
      action: CHANGE_USE_PROJECT_SKILLS_ACTION,
      handle: ({ projectId, useProjectSkills }) =>
        this.projectService.changeUseProjectSkills(projectId, useProjectSkills),
      response: (project: Project) => this.respond(project),
      words: (project) =>
        `Agents working on "${project.name}" ${project.useProjectSkills ? "use" : "don't use"} the skills of its repository now.`,
    });
  }

  private changeProjectSkillUse(): AnyProjectActionHandler {
    return handler({
      action: CHANGE_PROJECT_SKILL_USE_ACTION,
      handle: ({ projectId, key, use }) =>
        this.projectService.changeProjectSkillUse(projectId, key, use),
      response: (project: Project) => this.respond(project),
      words: (project, { key, use }) =>
        `The skill ${key} of "${project.name}" is ${use ? "on" : "off"} now.`,
    });
  }

  private setProjectImageFromRepository(): AnyProjectActionHandler {
    return handler({
      action: SET_PROJECT_IMAGE_FROM_REPOSITORY_ACTION,
      handle: ({ projectId, image, palette, commit, path }) =>
        this.images.changeFromRepository(projectId, image, palette, { commit, path }),
      response: (project: Project) => this.respond(project),
      words: (project, { image, palette, path }) =>
        `The ${palette} ${image} of "${project.name}" is a copy of ${path} now.`,
    });
  }

  private removeProjectImage(): AnyProjectActionHandler {
    return handler({
      action: REMOVE_PROJECT_IMAGE_ACTION,
      handle: ({ projectId, image, palette }) => this.images.remove(projectId, image, palette),
      response: (project: Project) => this.respond(project),
      words: (project, { image, palette }) =>
        `The ${palette} ${image} of "${project.name}" is removed.`,
    });
  }

  private changeProjectEngine(): AnyProjectActionHandler {
    return handler({
      action: CHANGE_PROJECT_ENGINE_ACTION,
      // The levels sent replace the Project's; the Project's id isn't one of them.
      handle: ({ projectId, ...change }) => this.projectService.changeEngine(projectId, change),
      response: (project: Project) => this.respond(project),
      words: (project) => `The Engine levels of "${project.name}" are changed as given.`,
    });
  }

  private changeDefaultPipeline(): AnyProjectActionHandler {
    return handler({
      action: CHANGE_DEFAULT_PIPELINE_ACTION,
      handle: ({ projectId, defaultPipeline }) =>
        this.projectService.changeDefaultPipeline(projectId, defaultPipeline),
      response: (project: Project) => this.respond(project),
      words: (project) =>
        `New Tasks of "${project.name}" follow the Pipeline ${project.defaultPipeline} by default now.`,
    });
  }

  private changeKindDefaultPipeline(): AnyProjectActionHandler {
    return handler({
      action: CHANGE_KIND_DEFAULT_PIPELINE_ACTION,
      handle: ({ projectId, kind, pipelineId }) =>
        this.projectService.changeKindDefaultPipeline(projectId, kind, pipelineId),
      response: (project: Project) => this.respond(project),
      words: (project, { kind, pipelineId }) =>
        pipelineId === null
          ? `New ${kind} Tasks of "${project.name}" follow the Project's Default Pipeline now.`
          : `New ${kind} Tasks of "${project.name}" follow the Pipeline ${pipelineId} now.`,
    });
  }

  private changeServerValues(): AnyProjectActionHandler {
    return handler({
      action: CHANGE_SERVER_VALUES_ACTION,
      handle: async ({ projectId, serverName, serverValues }) => {
        const project = await this.projectService.read(projectId);
        const edits = serverValues.map(({ name, projectValue }) => ({
          name,
          ...(projectValue !== undefined && { projectValue }),
        }));
        try {
          return await this.serverValues.change(project.id, serverName, edits);
        } catch (error) {
          // A change the library refuses is a refused change to the Project, in the same words.
          if (error instanceof McpServerRefused) throw new ProjectRefused(error.reasons);
          throw error;
        }
      },
      response: toProjectMcpServerValuesResponse,
      words: ({ serverName }) => `The Server values of ${serverName} are changed as given.`,
    });
  }

  /**
   * The Server values call's tool, ruled by Secret values besides Project settings when it gives a
   * secret's value, and showing that value by name only everywhere a card shows the call.
   */
  private withSecrets(tool: OfficeTool): OfficeTool {
    return {
      ...tool,
      ...(tool.authority && {
        authority: {
          ...tool.authority,
          groupsOf: async (input) =>
            (await this.secretsGiven(CHANGE_SERVER_VALUES_ACTION.input.parse(input))).length > 0
              ? [SECRET_VALUES_GROUP]
              : [],
        },
      }),
      redact: (input) => this.withoutSecretValues(CHANGE_SERVER_VALUES_ACTION.input.parse(input)),
      // Drafted from the call as shown: the secret named by its field only, never its value.
      draft: async (input) => {
        const call = CHANGE_SERVER_VALUES_ACTION.input.parse(input);
        const { shown } = await this.withoutSecretValues(call);
        const drafted = await this.draftOf(CHANGE_SERVER_VALUES_ACTION, shown);
        const secrets = await this.secretsGiven(call);
        return {
          ...drafted,
          fields: [
            ...drafted.fields,
            ...secrets.map((name) => ({
              label: `${name} (Secret value)`,
              before: null,
              after: null,
              form: "secret" as const,
            })),
          ],
        };
      },
    };
  }

  private async withoutSecretValues(
    call: z.output<typeof CHANGE_SERVER_VALUES_ACTION.input>,
  ): Promise<OfficeToolRedactedInput> {
    const secrets = new Set(await this.secretsGiven(call));
    return {
      hasSecret: secrets.size > 0,
      shown: {
        ...call,
        serverValues: call.serverValues.map((each) =>
          secrets.has(each.name) ? { name: each.name } : each,
        ),
      },
    };
  }

  /** The names of the Server values this call gives a value for that are secrets. */
  private async secretsGiven({
    projectId,
    serverName,
    serverValues,
  }: z.output<typeof CHANGE_SERVER_VALUES_ACTION.input>): Promise<readonly string[]> {
    const given = serverValues.filter(({ projectValue }) => projectValue !== undefined);
    if (given.length === 0) return [];
    const known = (await this.serverValues.of(projectId)).find(
      (each) => each.serverName === serverName,
    );
    return given
      .map(({ name }) => name)
      .filter((name) =>
        known?.serverValues.some(
          ({ serverValue }) => serverValue.name === name && serverValue.secret,
        ),
      );
  }

  private changePublishingMode(): AnyProjectActionHandler {
    return handler({
      action: CHANGE_PUBLISHING_MODE_ACTION,
      handle: ({ projectId, publishingMode }) =>
        this.projectService.changePublishingMode(projectId, publishingMode),
      response: (project: Project) => this.respond(project),
      words: (project) => `"${project.name}" publishes as ${project.publishingMode} now.`,
    });
  }

  private changeBeforePublishingCommand(): AnyProjectActionHandler {
    return handler({
      action: CHANGE_BEFORE_PUBLISHING_COMMAND_ACTION,
      handle: ({ projectId, commandLine }) =>
        this.projectService.changePublishingLine(projectId, "beforePublishingCommand", commandLine),
      response: (project: Project) => this.respond(project),
      words: (project) => `Before publishing, "${project.name}" runs its new command line.`,
    });
  }

  private changeAfterPublishingCommand(): AnyProjectActionHandler {
    return handler({
      action: CHANGE_AFTER_PUBLISHING_COMMAND_ACTION,
      handle: ({ projectId, commandLine }) =>
        this.projectService.changePublishingLine(projectId, "afterPublishingCommand", commandLine),
      response: (project: Project) => this.respond(project),
      words: (project) => `After publishing, "${project.name}" runs its new command line.`,
    });
  }

  private changeDeleteMergedBranches(): AnyProjectActionHandler {
    return handler({
      action: CHANGE_DELETE_MERGED_BRANCHES_ACTION,
      handle: ({ projectId, on }) => this.projectService.changeDeleteMergedBranches(projectId, on),
      response: (project: Project) => this.respond(project),
      words: (project) =>
        `"${project.name}" ${project.deleteMergedBranches ? "deletes" : "keeps"} a Task's branch once it is merged now.`,
    });
  }

  private changeIssueSettings(): AnyProjectActionHandler {
    return handler({
      action: CHANGE_ISSUE_SETTINGS_ACTION,
      handle: async ({ projectId, ...settings }, caller) =>
        this.projectService.changeIssueSettings(
          projectId,
          settings,
          issueUserOf(await caller.actedBy(), settings.autoImportLabel),
        ),
      response: (project: Project) => this.respond(project),
      words: (project) => `The GitHub issue switches of "${project.name}" are changed as given.`,
    });
  }

  private fetchBaseBranch(): AnyProjectActionHandler {
    return handler({
      action: FETCH_BASE_BRANCH_ACTION,
      handle: ({ projectId }) => this.files.fresh(projectId),
      response: ({ commit, fetchProblem }) => ({ commit, fetchProblem: fetchProblem ?? null }),
      words: ({ commit, fetchProblem }) =>
        fetchProblem === undefined
          ? `The base branch is fetched; its last commit is ${commit}.`
          : `The fetch failed (${fetchProblem}); the last commit known here is ${commit}.`,
    });
  }

  private importIssues(): AnyProjectActionHandler {
    return handler({
      action: IMPORT_ISSUES_ACTION,
      handle: async ({ projectId, numbers }, caller) =>
        this.issueImport.importByHand(projectId, numbers, await caller.actedBy()),
      response: ({ imported, skipped }) => ({ imported: [...imported], skipped: [...skipped] }),
      words: ({ imported, skipped }) =>
        [
          imported.length === 0
            ? "No issue was imported."
            : `Imported as Tasks in Backlog: ${imported.map(({ number, taskId }) => `#${number} (Task ${taskId})`).join(", ")}.`,
          ...skipped.map(({ number, why }) => `Skipped #${number}: ${why}`),
        ].join("\n"),
    });
  }

  private closePullRequest(): AnyProjectActionHandler {
    return handler({
      action: CLOSE_PULL_REQUEST_ACTION,
      handle: async ({ pullRequestId }, caller) => {
        const pullRequest = await this.pullRequests.findById(pullRequestId);
        await this.pullRequestActions.close(pullRequestId, await caller.actedBy());
        return pullRequest;
      },
      response: () => undefined,
      words: (pullRequest: PullRequest | undefined) =>
        pullRequest
          ? `Pull request #${pullRequest.number} "${pullRequest.title}" is closed, not merged.`
          : "The pull request is closed, not merged.",
    });
  }

  private setUpRunEnvironment(): AnyProjectActionHandler {
    return handler({
      action: SET_UP_RUN_ENVIRONMENT_ACTION,
      // Run environments answers it as the API shows it; Projects only passes it on, checked.
      handle: async ({ projectId }, caller): Promise<RunEnvironmentSetUpAnswer> =>
        runEnvironmentSetUpAnswerSchema.parse(
          await this.runEnvironmentSetUp.setUp(projectId, await caller.actedBy()),
        ),
      response: (answer: RunEnvironmentSetUpAnswer) => answer,
      words: ({ runEnvironment, start }) => {
        if (start === null) return `The run environment is ${runEnvironment.runEnvironment} now.`;
        if (start.outcome === "refused") {
          return `The set-up Task didn't start: ${start.reasons.join(" ")}`;
        }
        return `The set-up Task "${start.offBoardTask.title}" ${start.outcome === "started" ? "starts" : "is in flight"}.`;
      },
    });
  }

  /**
   * Re-runs a failed or cancelled run on the Project's code host, then lists its runs again at
   * once, so Work › CI shows it queued.
   */
  private async rerun(projectId: string, runId: number, jobs: CiRunJobs): Promise<Rerun> {
    const project = await this.projects.find(projectId);
    if (project === undefined) throw new ProjectNotFound(projectId);
    const onHost = await this.ciRuns.onHost(project);
    if (onHost === undefined) {
      throw new ProjectRefused([
        `"${project.name}" has no CI runs to re-run: its base branch tracks no remote on a code host The Office knows.`,
      ]);
    }
    const { remoteUrl, host } = onHost;
    try {
      const run =
        this.ciRuns.runOf(project.id, runId) ??
        (await host.recentRuns(remoteUrl, 100)).find((each) => each.id === runId);
      if (run === undefined) {
        throw new ProjectRefused([
          `"${project.name}" has no CI run ${runId} among its recent runs on ${host.name}.`,
        ]);
      }
      ensureRerunnable(run);
      await host.rerun(remoteUrl, run.id, jobs);
      // Its listing failing fails no re-run: the run runs again all the same, and the next round lists it.
      await this.ciRuns.refresh(project.id, { force: true }).catch((error: unknown) => {
        this.logger.warn(
          `Listing the CI runs of ${project.name} after a re-run failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      return { project, run, jobs };
    } catch (error) {
      if (error instanceof CodeHostRefused) throw new ProjectRefused([error.message]);
      throw error;
    }
  }
}

/**
 * The value of each field an action writes that is read as it stands now, by the action's input
 * name, for a Proposal's card to show before and after.
 */
function valuesOf(action: OfficeAction, project: Project): Record<string, unknown> {
  switch (action.name) {
    case CHANGE_PROJECT_LIMIT_ACTION.name:
      return { projectLimit: project.projectLimit };
    case CHANGE_PROJECT_MARK_ACTION.name:
      return { mark: project.mark };
    case CHANGE_USE_PROJECT_SKILLS_ACTION.name:
      return { useProjectSkills: project.useProjectSkills };
    case CHANGE_DEFAULT_PIPELINE_ACTION.name:
      return { defaultPipeline: project.defaultPipeline };
    case CHANGE_PUBLISHING_MODE_ACTION.name:
      return { publishingMode: project.publishingMode };
    case CHANGE_BEFORE_PUBLISHING_COMMAND_ACTION.name:
      return { commandLine: project.beforePublishingCommand };
    case CHANGE_AFTER_PUBLISHING_COMMAND_ACTION.name:
      return { commandLine: project.afterPublishingCommand };
    case CHANGE_DELETE_MERGED_BRANCHES_ACTION.name:
      return { on: project.deleteMergedBranches };
    case CHANGE_ISSUE_SETTINGS_ACTION.name: {
      const { autoImportLabel, closeOnDone, commentOnStartAndDone, closeOnDrop } =
        project.issueSettings;
      return { autoImportLabel, closeOnDone, commentOnStartAndDone, closeOnDrop };
    }
    default:
      // Nothing of the Project changes by the rest, or what they change isn't one field.
      return {};
  }
}

/**
 * The user the auto-import label is recorded as set by: the user, or the one behind the person's
 * call. Refused for a label no user stands behind, as the Tasks it imports name their creator.
 */
function issueUserOf(actedBy: ActedBy, label: string | null): IssueUser {
  const user =
    actedBy.kind === "user" ? actedBy.user : (actedBy.askedBy ?? actedBy.allowedBy ?? undefined);
  if (user) return { userId: user.userId, name: user.name };
  if (label === null) return { userId: "", name: "" };
  throw new ProjectRefused([
    "The auto-import label needs a user behind the call, as its Tasks name their creator: ask the user to ask for it in this Thread.",
  ]);
}

/** Projects' refusals answer the Agent in words it can act on; anything else fails the call. */
async function answered(read: () => Promise<string>): Promise<OfficeToolResult> {
  try {
    return { text: await read(), isError: false };
  } catch (error) {
    if (
      error instanceof ProjectRefused ||
      error instanceof ProjectNotFound ||
      error instanceof PullRequestRefused ||
      error instanceof PullRequestNotFound
    ) {
      return { text: error.message, isError: true };
    }
    throw error;
  }
}

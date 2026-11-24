import {
  officeCommandClash,
  projectPipelineFieldsSchema,
  proposedFeatureSwitchSchema,
  proposedRoutesSchema,
  stageSchema,
  type ChatActivity as ChatActivityResponse,
  type DecisionFormAnswer as DecisionFormAnswerResponse,
  type EditedAction as EditedActionResponse,
  type DecisionQuestion as DecisionQuestionResponse,
  type QuestionAnswer as QuestionAnswerResponse,
  type Decision as DecisionResponse,
  type Message as MessageResponse,
  type NewProject as NewProjectResponse,
  type PeopleWorking,
  type ProjectPipelineFields as ProjectPipelineFieldsResponse,
  type ProposedActions as ProposedActionsResponse,
  type ProposedProjectCommands as ProposedProjectCommandsResponse,
  type Proposal as ProposalResponse,
  type ProposedChange as ProposedChangeResponse,
  type ProposedFeatureSwitch as ProposedFeatureSwitchResponse,
  type ProposedRoutes as ProposedRoutesResponse,
  type ProposedTestTargetFields as ProposedTestTargetFieldsResponse,
  type ProposedTestTargets as ProposedTestTargetsResponse,
  type Stage as StageResponse,
  type Thread as ThreadResponse,
  type ThreadSummary as ThreadSummaryResponse,
  type TaskConversation,
  type TaskThreadSummary as TaskThreadSummaryResponse,
} from "@the-office/contracts";
import type { ThreadActivity } from "../../application/chat-activity.js";
import type { ThreadReading } from "../../application/thread-contexts.js";
import type { TaskThreadSummary, ThreadSummary } from "../../application/thread-summaries.js";
import type { PersonChatActivity } from "../../domain/chat-activity.js";
import type { ConversationTab } from "../../domain/conversation-tabs.js";
import {
  type Decision,
  type DecisionAnswer,
  type DecisionQuestion,
  type QuestionAnswer,
} from "../../domain/decision.js";
import { hiredKeyOf } from "../../../people/index.js";
import type {
  ActionFields,
  NewProject,
  ProposedTestTargetFields,
} from "../../../projects/index.js";
import type { Message } from "../../domain/message.js";
import { DEFAULT_CONTEXT_POLICY_SETTINGS } from "../../domain/context-policy.js";
import { stageLimitsWithin } from "../../domain/stage-context-limits.js";
import type { TaskPeopleWorking } from "../../domain/people-working.js";
import type {
  PipelineRoutes,
  PipelineStage,
  ProjectPipelineFields,
  Proposal,
  ProposedActionsChange,
  ProposedChange,
  ProposedFeatureSwitches,
  ProposedProjectCommands,
  ProposedTestTargetsChange,
} from "../../domain/proposal.js";
import { tokensSoFar, type Thread } from "../../domain/thread.js";

export function toThreadResponse(
  thread: Thread,
  { context, contextReported, changesAllowed, skillCommands }: ThreadReading,
  activity: ThreadActivity | undefined,
): ThreadResponse {
  return {
    id: thread.id,
    home: thread.home,
    roleKey: thread.roleKey,
    title: thread.title ?? null,
    state: thread.state,
    tokens: tokensSoFar(thread),
    context: {
      move: context.move,
      reason: context.reason,
      cacheWarm: context.cacheWarm,
      cacheWarmUntil: context.cacheWarmUntil?.toISOString() ?? null,
      contextTokens: context.contextTokens,
      contextWindow: thread.session?.contextWindow ?? null,
      contextReported,
      briefTokens: context.briefTokens ?? null,
      alternatives: context.alternatives.map(({ override, tokens }) => ({ override, tokens })),
      override: thread.override ?? null,
    },
    startedAt: thread.startedAt.toISOString(),
    stageThread: thread.stageThread,
    stageContextLimits: stageContextLimitsOf(thread),
    consultation: thread.consultation
      ? { ...thread.consultation, askerRoleKey: thread.consultation.askerRoleKey ?? null }
      : null,
    changesAllowed: changesAllowed ?? null,
    answered: activity?.answered ?? null,
    lastMovedAt: activity?.lastMovedAt.toISOString() ?? null,
    // A skill an Office command's name takes can't run as a command (spec §2.4).
    skillCommands: skillCommands
      .filter(({ name }) => !officeCommandClash(name))
      .map(({ name, description }) => ({ name, description })),
  };
}

/** A Stage Thread's limits as its session works under them: capped by its window once known. */
function stageContextLimitsOf({
  stageThread,
  stageContextLimits,
  session,
}: Thread): ThreadResponse["stageContextLimits"] {
  if (!stageThread || !stageContextLimits) return null;
  return stageLimitsWithin(
    stageContextLimits,
    session?.contextWindow,
    DEFAULT_CONTEXT_POLICY_SETTINGS.handOverAtShare,
  );
}

/** A list's row: its context's move, with no Brief's estimate and nothing to choose instead. */
export function toThreadSummaryResponse({
  thread,
  context,
  activity,
}: ThreadSummary): ThreadSummaryResponse {
  return {
    id: thread.id,
    home: thread.home,
    roleKey: thread.roleKey,
    title: thread.title ?? null,
    state: thread.state,
    tokens: tokensSoFar(thread),
    context: {
      move: context.move,
      reason: context.reason,
      cacheWarm: context.cacheWarm,
      cacheWarmUntil: context.cacheWarmUntil?.toISOString() ?? null,
      contextTokens: context.contextTokens,
    },
    startedAt: thread.startedAt.toISOString(),
    consultation: thread.consultation
      ? { ...thread.consultation, askerRoleKey: thread.consultation.askerRoleKey ?? null }
      : null,
    answered: activity?.answered ?? null,
    lastMovedAt: activity?.lastMovedAt.toISOString() ?? null,
  };
}

export function toTaskThreadSummaryResponse(summary: TaskThreadSummary): TaskThreadSummaryResponse {
  const { taskId, task } = summary;
  return {
    ...toThreadSummaryResponse(summary),
    task: { id: taskId, title: task.title, projectId: task.projectId },
  };
}

export function toPeopleWorkingResponse(tasks: readonly TaskPeopleWorking[]): PeopleWorking {
  return tasks.map(({ taskId, roleKeys }) => ({ taskId, roleKeys: [...roleKeys] }));
}

export function toChatActivityResponse(
  people: readonly PersonChatActivity[],
): ChatActivityResponse {
  return people.map(({ roleKey, answering, answered, lastMovedAt }) => ({
    roleKey,
    answering,
    answered: answered.map(({ threadId, at }) => ({ threadId, at: at.toISOString() })),
    lastMovedAt: lastMovedAt.toISOString(),
  }));
}

/**
 * The Thread's Decisions and Proposals by id, which its log's cards show, and the people its Link
 * cards point to who have been let go since.
 */
export interface CardRecords {
  readonly decisions: ReadonlyMap<string, Decision>;
  readonly proposals: ReadonlyMap<string, Proposal>;
  readonly letGo: ReadonlySet<string>;
}

/**
 * A message of the log; a Decision's card and answer show the Decision as it is now, and the
 * answer's line also the answer it gave, which a Decision opened again no longer holds. A
 * Proposal's card shows the Proposal as it is now, and a Link card whether its person was let go.
 */
export function toTaskConversationResponse(tabs: readonly ConversationTab[]): TaskConversation {
  return {
    tabs: tabs.map(
      ({ roleKey, threadId, stageRunning, consultations, planningThreadElsewhere }) => ({
        roleKey,
        threadId: threadId ?? null,
        stageRunning,
        planningThreadElsewhere: planningThreadElsewhere ? { ...planningThreadElsewhere } : null,
        consultations: consultations.map(({ note, answeredAt, ...consultation }) => ({
          ...consultation,
          note: note ?? null,
          answeredAt: answeredAt?.toISOString() ?? null,
        })),
      }),
    ),
  };
}

export function toMessageResponse(
  { threadId: _threadId, at, ...message }: Message,
  { decisions, proposals, letGo }: CardRecords,
): MessageResponse {
  const fields = { ...message, at: at.toISOString() };
  switch (fields.kind) {
    case "user":
      return {
        ...fields,
        handoverNoteFrom: fields.handoverNoteFrom ?? null,
        openPage: fields.openPage ?? null,
        images: (fields.images ?? []).map(({ attachmentId, name, mediaType }) => ({
          attachmentId,
          name,
          mediaType,
        })),
      };
    case "link-card": {
      const { to, taskId, ...card } = fields;
      return { ...card, to: { roleKey: to, letGo: letGo.has(to) }, taskId: taskId ?? null };
    }
    case "context":
      return { ...fields, briefTokens: fields.briefTokens ?? null, brief: fields.brief ?? null };
    case "mcp-server-not-started":
      return { ...fields, reason: fields.reason ?? null };
    case "decision": {
      const { decisionId, roleKey, ...card } = fields;
      return {
        ...card,
        roleKey: roleKey ?? null,
        decision: toDecisionResponse(decisionOf(message.id, decisionId, decisions)),
      };
    }
    case "decision-answer": {
      const { decisionId, answer, atUsersRequest, ...line } = fields;
      const decision = decisionOf(message.id, decisionId, decisions);
      return {
        ...line,
        formAnswer: toFormAnswerResponse(answer),
        atUsersRequest: atUsersRequest ? { ...atUsersRequest } : null,
        decision: toDecisionResponse(decision),
      };
    }
    case "proposal": {
      const { proposalId, ...card } = fields;
      const proposal = proposals.get(proposalId);
      if (!proposal) {
        throw new Error(`Message ${message.id} shows the Proposal ${proposalId}, which is gone.`);
      }
      return { ...card, proposal: toProposalResponse(proposal) };
    }
    default:
      return fields;
  }
}

export function toProposalResponse({
  draftedAt,
  change,
  status,
  ...proposal
}: Proposal): ProposalResponse {
  return {
    ...proposal,
    draftedAt: draftedAt.toISOString(),
    change: toProposedChangeResponse(change),
    status:
      status.kind === "open"
        ? status
        : { kind: status.kind, at: status.at.toISOString(), by: status.by },
  };
}

function toProposedChangeResponse(change: ProposedChange): ProposedChangeResponse {
  switch (change.kind) {
    case "hire":
      return {
        kind: "hire",
        card: { ...change.card, skills: [...change.skills] },
        roleKey: change.roleKey ?? null,
      };
    case "hire-from-preset":
      return { kind: "hire-from-preset", roleKey: change.roleKey, name: change.name };
    case "change":
      return { kind: "change", roleKey: change.roleKey, from: change.from, to: change.to };
    case "office-wide-limit":
    case "size-threshold":
      return { kind: change.kind, from: change.from, to: change.to };
    case "office-instructions":
      return { kind: change.kind, from: change.from, to: change.to };
    case "duties":
      return { kind: change.kind, from: change.from, to: change.to };
    case "prompt-template":
      return {
        kind: change.kind,
        key: change.key,
        name: change.name,
        from: change.from,
        to: change.to,
      };
    case "office-setup":
      return {
        kind: "office-setup",
        hires: change.hires.map((hire) =>
          hire.kind === "hire"
            ? {
                kind: "hire",
                card: { ...hire.card, skills: [...hire.skills] },
                roleKey: hiredKeyOf(hire),
              }
            : { kind: "hire-from-preset", roleKey: hire.roleKey, name: hire.name },
        ),
        duties: change.duties.map(({ duty, from, to }) => ({ duty, from, to })),
        hiredKeys: change.hiredKeys ? [...change.hiredKeys] : null,
      };
    case "initiative":
      return {
        kind: "initiative",
        initiativeId: change.initiativeId,
        edit:
          change.edit.kind === "add-task"
            ? {
                ...change.edit,
                description: change.edit.description ?? "",
                blockedBy: [...change.edit.blockedBy],
                taskId: change.edit.taskId ?? null,
              }
            : change.edit,
      };
    case "project-commands":
      return {
        kind: "project-commands",
        projectId: change.projectId,
        changes: toProposedProjectCommandsResponse(change.changes),
      };
    case "test-targets":
      return {
        kind: "test-targets",
        projectId: change.projectId,
        changes: toProposedTestTargetsResponse(change.changes),
      };
    case "actions":
      return {
        kind: "actions",
        projectId: change.projectId,
        changes: toProposedActionsResponse(change.changes),
      };
    case "pipeline":
      return {
        kind: "pipeline",
        pipelineId: change.pipelineId,
        // Pipelines gave the Stages; Conversations keeps them unread, so they are read here.
        ...pipelineStagesOf(change.from, change.to),
        routes: routesOf(change.routes),
      };
    case "stage-template":
      return {
        kind: "stage-template",
        templateId: change.templateId,
        ...templateStagesOf(change.from, change.to),
      };
    case "project-pipeline":
      return {
        kind: "project-pipeline",
        projectId: change.projectId,
        pipelineId: change.pipelineId,
        // The Stages are kept unread, as a Pipeline's Stages are, so they are read here.
        from: change.from && projectPipelineFieldsOf(change.from),
        to: projectPipelineFieldsOf(change.to),
        routes: routesOf(change.routes),
      };
    case "project":
      return {
        kind: "project",
        project: toNewProjectResponse(change.project),
        features: toProposedFeatureSwitchesResponse(change.features ?? {}),
        projectId: change.projectId ?? null,
        taskId: change.taskId ?? null,
      };
    case "skill-install":
      return {
        kind: "skill-install",
        repository: change.repository,
        folder: change.folder,
        pinnedVersion: { ...change.pinnedVersion },
        name: change.name,
        description: change.description,
        files: [...change.files],
        filesHash: change.filesHash,
      };
    case "skill-update":
      return {
        kind: "skill-update",
        name: change.name,
        repository: change.repository,
        folder: change.folder,
        from: { ...change.from },
        to: { ...change.to },
        notes: change.notes,
        files: [...change.files],
        filesHash: change.filesHash,
        appliedDiff: change.appliedDiff ? { ...change.appliedDiff } : null,
      };
    case "skill":
      return {
        kind: "skill",
        name: change.name,
        description: change.description,
        instructions: change.instructions,
      };
  }
}

/** In the features' order, only those proposed. */
function toProposedFeatureSwitchesResponse(
  features: ProposedFeatureSwitches,
): ProposedFeatureSwitchResponse[] {
  return proposedFeatureSwitchSchema.shape.feature.options.flatMap((feature) => {
    const proposed = features[feature];
    return proposed ? [{ feature, on: proposed.on, reason: proposed.reason }] : [];
  });
}

function toNewProjectResponse(project: NewProject): NewProjectResponse {
  return {
    name: project.name,
    path: project.path,
    repositoryUrl: project.repositoryUrl,
    baseBranch: project.baseBranch,
    mark: { label: project.mark.label, colour: project.mark.colour },
    installCommand: project.installCommand,
    commands: project.commands.map((command) => ({ ...command })),
    installInputs: [...project.installInputs],
    publishingMode: project.publishingMode,
    defaultPipeline: project.defaultPipeline,
  };
}

const STAGES = stageSchema.array();

/**
 * Pipelines gave the routes; Conversations keeps them unread, so they are read here. Ones that
 * don't read show as none, so one kept Proposal can't stop its Thread from reading.
 */
function routesOf(routes: PipelineRoutes | undefined): ProposedRoutesResponse | null {
  const read = routes && proposedRoutesSchema.safeParse(routes);
  return read?.success ? read.data : null;
}

/**
 * A library Pipeline Proposal's Stages as the card shows them. Ones Pipelines' card reading
 * (`ProposalAppliers.shown`) left unread show as none, both sides alike, so one kept Proposal can't
 * stop its Thread from reading; applying it is refused.
 */
function pipelineStagesOf(
  from: readonly PipelineStage[],
  to: readonly PipelineStage[],
): { readonly from: StageResponse[]; readonly to: StageResponse[] } {
  const readFrom = STAGES.safeParse(from);
  const readTo = STAGES.safeParse(to);
  return readFrom.success && readTo.success
    ? { from: readFrom.data, to: readTo.data }
    : { from: [], to: [] };
}

/**
 * A Stage template Proposal's Stage as the card shows it. One Pipelines' card reading left unread
 * shows, both sides alike, as a Gate by its key and name, so the card names only a change of name
 * and one kept Proposal can't stop its Thread from reading; applying it is refused.
 */
function templateStagesOf(
  from: PipelineStage,
  to: PipelineStage,
): { readonly from: StageResponse; readonly to: StageResponse } {
  const readFrom = stageSchema.safeParse(from);
  const readTo = stageSchema.safeParse(to);
  return readFrom.success && readTo.success
    ? { from: readFrom.data, to: readTo.data }
    : { from: unreadStage(from), to: unreadStage(to) };
}

function unreadStage(stage: PipelineStage): StageResponse {
  const { key, name } = stage as { readonly key?: unknown; readonly name?: unknown };
  return {
    kind: "gate",
    key: typeof key === "string" && key !== "" ? key : "stage",
    name: typeof name === "string" ? name : "",
    optional: false,
  };
}

function toProposedProjectCommandsResponse({
  installCommand,
  installInputs,
  beforePublishingCommand,
  afterPublishingCommand,
  commands,
}: ProposedProjectCommands["changes"]): ProposedProjectCommandsResponse {
  return {
    ...(installCommand && { installCommand: { ...installCommand } }),
    ...(beforePublishingCommand && { beforePublishingCommand: { ...beforePublishingCommand } }),
    ...(afterPublishingCommand && { afterPublishingCommand: { ...afterPublishingCommand } }),
    ...(installInputs && {
      installInputs: { from: [...installInputs.from], to: [...installInputs.to] },
    }),
    commands: commands.map(({ key, from, to }) => ({
      key,
      from: from && { ...from },
      to: to && { ...to },
    })),
  };
}

function toProposedTestTargetsResponse({
  targets,
}: ProposedTestTargetsChange["changes"]): ProposedTestTargetsResponse {
  return {
    targets: targets.map(({ key, from, to, userSet }) => ({
      key,
      from: from && toProposedTestTargetFieldsResponse(from),
      to: to && toProposedTestTargetFieldsResponse(to),
      userSet: [...userSet],
    })),
  };
}

function toProposedActionsResponse({
  actions,
}: ProposedActionsChange["changes"]): ProposedActionsResponse {
  return {
    actions: actions.map(({ key, from, to, userSet }) => ({
      key,
      from: from && toEditedActionResponse(from),
      to: to && toEditedActionResponse(to),
      userSet: [...userSet],
    })),
  };
}

function toEditedActionResponse(action: ActionFields): EditedActionResponse {
  const head = {
    key: action.key,
    name: action.name,
    leavesTheWorkstation: action.leavesTheWorkstation,
  };
  switch (action.kind) {
    case "project-command":
      return {
        ...head,
        kind: action.kind,
        settings: {
          commandKey: action.settings.commandKey,
          commandsBefore: [...action.settings.commandsBefore],
          timeLimitMinutes: action.settings.timeLimitMinutes,
        },
      };
    case "test-target":
      return { ...head, kind: action.kind, settings: { targetKey: action.settings.targetKey } };
    case "workflow":
      return {
        ...head,
        kind: action.kind,
        settings: { file: action.settings.file, inputs: { ...action.settings.inputs } },
      };
  }
}

function toProposedTestTargetFieldsResponse(
  fields: ProposedTestTargetFields,
): ProposedTestTargetFieldsResponse {
  const entryPoint =
    fields.entryPoint.kind === "devcontainer-service"
      ? { ...fields.entryPoint }
      : { ...fields.entryPoint, arguments: [...fields.entryPoint.arguments] };
  const shared = {
    key: fields.key,
    name: fields.name,
    entryPoint,
    variables: fields.variables.map(({ name, value }) => ({ name, value })),
    secretVariables: [...fields.secretVariables],
    commandsBefore: [...fields.commandsBefore],
    memoryMegabytes: fields.memoryMegabytes,
  };
  return fields.kind === "build-to-install"
    ? { ...shared, kind: fields.kind, outputPatterns: [...fields.outputPatterns] }
    : { ...shared, kind: fields.kind, port: fields.port, portVariable: fields.portVariable };
}

function decisionOf(
  messageId: string,
  decisionId: string,
  decisions: ReadonlyMap<string, Decision>,
): Decision {
  const decision = decisions.get(decisionId);
  if (!decision) {
    throw new Error(`Message ${messageId} shows the Decision ${decisionId}, which is gone.`);
  }
  return decision;
}

/** The Decision with its form and, once answered, the form's answer. */
export function toDecisionResponse({
  answer,
  askedAt,
  closedAt,
  questions,
  bugTask,
  ...decision
}: Decision): DecisionResponse {
  return {
    ...decision,
    ...(bugTask === undefined
      ? {}
      : {
          bugTask: {
            title: bugTask.title,
            description: bugTask.description,
            why: bugTask.why,
            projectId: bugTask.projectId,
            causedBy: bugTask.causedBy ?? null,
          },
        }),
    taskId: decision.taskId ?? null,
    roleKey: decision.roleKey ?? null,
    putTo: decision.putTo ?? null,
    passedOn: decision.passedOn.map(({ passedOnAt, ...passing }) => ({
      ...passing,
      passedOnAt: passedOnAt.toISOString(),
    })),
    questions: questions.map(toQuestionResponse),
    attachmentIds: [...decision.attachmentIds],
    askedAt: askedAt.toISOString(),
    formAnswer: answer ? toFormAnswerResponse(answer) : null,
    answeredAt: answer?.answeredAt.toISOString() ?? null,
    closedAt: closedAt?.toISOString() ?? null,
    // No column keeps why: only a Decision on no Task in an Initiative's Thread closes as its
    // Initiative ends, every other closes as its Task is dropped.
    closedBecause: closedAt
      ? decision.taskId === undefined
        ? "initiative-ended"
        : "task-dropped"
      : null,
    answeredByUser: answer?.user ?? null,
    answeredBy: answer?.answeredBy ?? null,
    atUsersRequest: answer?.atUsersRequest ? { ...answer.atUsersRequest } : null,
    answeredByTheOffice: answer?.byTheOffice === true,
  };
}

function toQuestionResponse(question: DecisionQuestion): DecisionQuestionResponse {
  switch (question.kind) {
    case "choice":
      return {
        ...question,
        options: [...question.options],
        recommendation: { ...question.recommendation },
      };
    case "choice-of-several":
      return {
        ...question,
        options: [...question.options],
        recommendation: {
          options: [...question.recommendation.options],
          reason: question.recommendation.reason,
        },
      };
    case "open":
      return { ...question };
  }
}

function toQuestionAnswerResponse(given: QuestionAnswer): QuestionAnswerResponse {
  const comment = given.comment === undefined ? {} : { comment: given.comment };
  switch (given.kind) {
    case "option":
      return { kind: "option", option: given.option, ...comment };
    case "options":
      return { kind: "options", options: [...given.options], ...comment };
    case "words":
      return { kind: "words", text: given.text, ...comment };
  }
}

function toFormAnswerResponse(answer: DecisionAnswer): DecisionFormAnswerResponse {
  if (answer.kind === "asked-again" || answer.kind === "dismissed") {
    return {
      kind: answer.kind,
      ...(answer.generalComment === undefined ? {} : { generalComment: answer.generalComment }),
    };
  }
  return {
    kind: "submitted",
    answers: answer.answers.map(toQuestionAnswerResponse),
    ...(answer.generalComment === undefined ? {} : { generalComment: answer.generalComment }),
    ...(answer.bugTask === undefined
      ? {}
      : {
          bugTask: {
            title: answer.bugTask.title,
            description: answer.bugTask.description,
            projectId: answer.bugTask.projectId,
            causedBy: answer.bugTask.causedBy ?? null,
          },
        }),
    ...(answer.createdTaskId === undefined ? {} : { createdTaskId: answer.createdTaskId }),
  };
}

/**
 * A Project Pipeline Proposal's fields as the card shows them. One drafted before Project Pipelines
 * held their own flow kept a base Pipeline and Stage changes, which don't read: it shows by its name
 * with no Stages, and applying it is refused.
 */
function projectPipelineFieldsOf(fields: ProjectPipelineFields): ProjectPipelineFieldsResponse {
  const read = projectPipelineFieldsSchema.safeParse(fields);
  if (read.success) return read.data;
  const { name, description } = fields as Partial<ProjectPipelineFields>;
  return {
    name: typeof name === "string" ? name : "",
    description: typeof description === "string" ? description : "",
    stages: [],
  };
}

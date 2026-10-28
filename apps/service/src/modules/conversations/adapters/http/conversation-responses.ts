import {
  stageSchema,
  type DecisionAnswer as DecisionAnswerResponse,
  type Decision as DecisionResponse,
  type Message as MessageResponse,
  type NewProject as NewProjectResponse,
  type ProjectCommandFields as ProjectCommandFieldsResponse,
  type Proposal as ProposalResponse,
  type ProposedChange as ProposedChangeResponse,
  type Thread as ThreadResponse,
} from "@the-office/contracts";
import type { ContextDecision } from "../../domain/context-policy.js";
import type { Decision, DecisionAnswer } from "../../domain/decision.js";
import type { NewProject } from "../../../projects/index.js";
import type { Message } from "../../domain/message.js";
import type { Proposal, ProposedChange, ProposedProjectCommands } from "../../domain/proposal.js";
import { tokensSoFar, type Thread } from "../../domain/thread.js";

export function toThreadResponse(thread: Thread, context: ContextDecision): ThreadResponse {
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
      contextTokens: context.contextTokens,
      briefTokens: context.briefTokens ?? null,
      alternatives: context.alternatives.map(({ override, tokens }) => ({ override, tokens })),
      override: thread.override ?? null,
    },
    startedAt: thread.startedAt.toISOString(),
    stageThread: thread.stageThread,
    consultation: thread.consultation
      ? { ...thread.consultation, askerRoleKey: thread.consultation.askerRoleKey ?? null }
      : null,
  };
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
export function toMessageResponse(
  { threadId: _threadId, at, ...message }: Message,
  { decisions, proposals, letGo }: CardRecords,
): MessageResponse {
  const fields = { ...message, at: at.toISOString() };
  switch (fields.kind) {
    case "user":
      return { ...fields, handoverNoteFrom: fields.handoverNoteFrom ?? null };
    case "link-card": {
      const { to, taskId, ...card } = fields;
      return { ...card, to: { roleKey: to, letGo: letGo.has(to) }, taskId: taskId ?? null };
    }
    case "context":
      return { ...fields, briefTokens: fields.briefTokens ?? null, brief: fields.brief ?? null };
    case "decision": {
      const { decisionId, roleKey, ...card } = fields;
      return {
        ...card,
        roleKey: roleKey ?? null,
        decision: toDecisionResponse(decisionOf(message.id, decisionId, decisions)),
      };
    }
    case "decision-answer": {
      const { decisionId, answer, ...line } = fields;
      return {
        ...line,
        answer: toAnswerResponse(answer),
        decision: toDecisionResponse(decisionOf(message.id, decisionId, decisions)),
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
    status: status.kind === "open" ? status : { kind: status.kind, at: status.at.toISOString() },
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
    case "initiative":
      return {
        kind: "initiative",
        initiativeId: change.initiativeId,
        edit:
          change.edit.kind === "add-task"
            ? { ...change.edit, taskId: change.edit.taskId ?? null }
            : change.edit,
      };
    case "project-commands":
      return {
        kind: "project-commands",
        projectId: change.projectId,
        from: toProjectCommandFieldsResponse(change.from),
        to: toProjectCommandFieldsResponse(change.to),
      };
    case "pipeline":
      return {
        kind: "pipeline",
        pipelineId: change.pipelineId,
        // Pipelines gave the Stages; Conversations keeps them unread, so they are read here.
        from: STAGES.parse(change.from),
        to: STAGES.parse(change.to),
      };
    case "project":
      return {
        kind: "project",
        project: toNewProjectResponse(change.project),
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
  }
}

function toNewProjectResponse(project: NewProject): NewProjectResponse {
  return {
    name: project.name,
    path: project.path,
    baseBranch: project.baseBranch,
    mark: { label: project.mark.label, colour: project.mark.colour },
    commands: { ...project.commands },
    installInputs: [...project.installInputs],
    publishingMode: project.publishingMode,
    defaultPipeline: project.defaultPipeline,
  };
}

const STAGES = stageSchema.array();

function toProjectCommandFieldsResponse({
  installInputs,
  ...commands
}: ProposedProjectCommands["from"]): ProjectCommandFieldsResponse {
  return installInputs ? { ...commands, installInputs: [...installInputs] } : commands;
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

export function toDecisionResponse({ answer, askedAt, ...decision }: Decision): DecisionResponse {
  return {
    ...decision,
    roleKey: decision.roleKey ?? null,
    putTo: decision.putTo ?? null,
    passedOn: decision.passedOn.map(({ passedOnAt, ...passing }) => ({
      ...passing,
      passedOnAt: passedOnAt.toISOString(),
    })),
    options: [...decision.options],
    recommendation: { ...decision.recommendation },
    askedAt: askedAt.toISOString(),
    answer: answer ? toAnswerResponse(answer) : null,
    answeredAt: answer?.answeredAt.toISOString() ?? null,
    answeredBy: answer?.answeredBy ?? null,
  };
}

function toAnswerResponse(answer: DecisionAnswer): DecisionAnswerResponse {
  return answer.kind === "option"
    ? { kind: "option", option: answer.option }
    : { kind: "free-answer", text: answer.text };
}

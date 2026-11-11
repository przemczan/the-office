import type {
  OutputChunk as OutputChunkResponse,
  Process as ProcessResponse,
  ProcessOutput,
  SubAgent as SubAgentResponse,
  SubAgentMessage as SubAgentMessageResponse,
  SubAgentMessages,
  SubAgentOrProcess as SubAgentOrProcessResponse,
} from "@the-office/contracts";
import type {
  ProcessOutputRead,
  SubAgentMessagesRead,
} from "../../application/sub-agents-and-processes.js";
import {
  stateOf,
  type OutputChunk,
  type Process,
  type SubAgent,
  type SubAgentMessage,
  type SubAgentOrProcess,
} from "../../domain/sub-agents-and-processes.js";

export function toSubAgentOrProcessResponse(item: SubAgentOrProcess): SubAgentOrProcessResponse {
  return item.kind === "sub-agent" ? toSubAgentResponse(item) : toProcessResponse(item);
}

export function toSubAgentResponse(subAgent: SubAgent): SubAgentResponse {
  return {
    ...sharedFields(subAgent),
    kind: "sub-agent",
    agentKind: subAgent.agentKind ?? null,
    prompt: subAgent.prompt,
    background: subAgent.background,
    reportedBack: subAgent.reportedBack ?? null,
    toolCallCount: subAgent.toolCallCount ?? null,
    totalTokens: subAgent.totalTokens ?? null,
    earlierMessagesNotKept: subAgent.earlierMessagesNotKept,
  };
}

export function toProcessResponse(startedProcess: Process): ProcessResponse {
  return {
    ...sharedFields(startedProcess),
    kind: "process",
    commandLine: startedProcess.commandLine,
    exitCode: startedProcess.exitCode ?? null,
    earlierOutputNotKept: startedProcess.earlierOutputNotKept,
  };
}

export function toSubAgentMessageResponse(message: SubAgentMessage): SubAgentMessageResponse {
  return { ...message, at: message.at.toISOString() };
}

export function toSubAgentMessagesResponse(read: SubAgentMessagesRead): SubAgentMessages {
  return {
    messages: read.messages.map(toSubAgentMessageResponse),
    lastSequence: read.lastSequence,
    earlierNotKept: read.earlierNotKept,
  };
}

export function toOutputChunkResponse({ sequence, text }: OutputChunk): OutputChunkResponse {
  return { sequence, text };
}

export function toProcessOutputResponse(read: ProcessOutputRead): ProcessOutput {
  return {
    chunks: read.chunks.map(toOutputChunkResponse),
    lastSequence: read.lastSequence,
    earlierNotKept: read.earlierNotKept,
  };
}

function sharedFields(item: SubAgentOrProcess) {
  return {
    callId: item.callId,
    engineTaskId: item.engineTaskId ?? null,
    startedBy: item.startedBy ?? null,
    description: item.description,
    state: stateOf(item),
    ending: item.ending ?? null,
    startedAt: item.startedAt.toISOString(),
    endedAt: item.endedAt?.toISOString() ?? null,
    revision: item.revision,
    lastSequence: item.lastSequence,
  };
}

import type {
  OutputChunk,
  Process,
  SubAgent,
  SubAgentMessage,
  SubAgentOrProcess,
  WebEvent,
} from "@the-office/contracts";
import type { ThreadSubscription } from "../../api/event-stream.ts";
import type { ThreadEvents } from "../../api/event-stream-provider.tsx";

export const THREAD_ID = "6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
export const STARTED_AT = "2026-11-11T14:02:00.000Z";

export function aSubAgent(fields: Partial<SubAgent> = {}): SubAgent {
  return {
    kind: "sub-agent",
    callId: "toolu_explore",
    engineTaskId: null,
    startedBy: null,
    description: "Find where Threads are read and searched",
    state: "running",
    ending: null,
    startedAt: STARTED_AT,
    endedAt: null,
    revision: 0,
    lastSequence: 0,
    agentKind: "Explore",
    prompt: "Find every place the service reads or searches a Thread's messages.",
    background: false,
    reportedBack: null,
    toolCallCount: null,
    totalTokens: null,
    earlierMessagesNotKept: 0,
    ...fields,
  };
}

export function aProcess(fields: Partial<Process> = {}): Process {
  return {
    kind: "process",
    callId: "toolu_dev_server",
    engineTaskId: "b1f9c2e07",
    startedBy: null,
    description: "Start the web app",
    state: "running",
    ending: null,
    startedAt: STARTED_AT,
    endedAt: null,
    revision: 0,
    lastSequence: 0,
    commandLine: "npm run dev -w apps/web",
    exitCode: null,
    earlierOutputNotKept: 0,
    ...fields,
  };
}

/** Ended `after` milliseconds from the start, as the service writes an end. */
export function endedAfter(milliseconds: number): string {
  return new Date(Date.parse(STARTED_AT) + milliseconds).toISOString();
}

/**
 * A Thread's events as a test sends them: each subscription is put in place at once, `send`
 * passes an event to those subscribed to its type for its Thread, and `reconnect` puts every one in
 * place again, as a new connection does.
 */
export class TestThreadEvents implements ThreadEvents {
  readonly subscriptions = new Set<ThreadSubscription>();

  subscribeToThread(subscription: ThreadSubscription): () => void {
    this.subscriptions.add(subscription);
    subscription.onSubscribed?.();
    return () => this.subscriptions.delete(subscription);
  }

  send(event: WebEvent & { readonly threadId: string }): void {
    for (const subscription of this.subscriptions) {
      if (
        subscription.threadId === event.threadId &&
        subscription.eventTypes.includes(event.type)
      ) {
        subscription.onEvent(event);
      }
    }
  }

  reconnect(): void {
    for (const subscription of this.subscriptions) subscription.onSubscribed?.();
  }

  /** The event types subscribed to now, each once. */
  subscribedTypes(): string[] {
    return [...new Set([...this.subscriptions].flatMap(({ eventTypes }) => eventTypes))].toSorted();
  }
}

/**
 * The service as `fetch` answers it: the Thread's list and each item's messages and output, read
 * after `?after=` as the service reads them; `reads` holds each path asked for.
 */
export class TestService {
  list: SubAgentOrProcess[] = [];
  readonly output = new Map<string, OutputChunk[]>();
  readonly messages = new Map<string, SubAgentMessage[]>();
  earlierOutputNotKept = 0;
  /** While set, a Process's output can't be read: the service answers 500. */
  outputUnreadable = false;
  readonly reads: string[] = [];

  readonly fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), "http://office.test");
    this.reads.push(`${url.pathname}${url.search}`);
    const after = Number(url.searchParams.get("after") ?? 0);
    const [, , , , what, callId] = url.pathname.split("/");
    if (what === "sub-agents-and-processes") return answer(this.list);
    if (what === "processes" && callId !== undefined) {
      if (this.outputUnreadable) {
        return new Response(JSON.stringify({ message: "The output store is down." }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      const chunks = this.output.get(decodeURIComponent(callId)) ?? [];
      return answer({
        chunks: chunks.filter(({ sequence }) => sequence > after),
        lastSequence: chunks.at(-1)?.sequence ?? after,
        earlierNotKept: this.earlierOutputNotKept,
      });
    }
    const kept = this.messages.get(decodeURIComponent(callId ?? "")) ?? [];
    return answer({
      messages: kept.filter(({ sequence }) => sequence > after),
      lastSequence: kept.at(-1)?.sequence ?? after,
      earlierNotKept: 0,
    });
  };
}

function answer(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

const OF_THE_THREAD = {
  threadId: THREAD_ID,
  home: { kind: "chat", roleKey: "developer" },
  occurredAt: STARTED_AT,
} as const;

export function outputEvent(callId: string, sequence: number, text: string) {
  return { ...OF_THE_THREAD, type: "thread.process-output", callId, chunk: { sequence, text } };
}

export function messagesEvent(callId: string, messages: SubAgentMessage[]) {
  return { ...OF_THE_THREAD, type: "thread.sub-agent-messages", callId, messages };
}

export function itemEvent(type: string, item: SubAgentOrProcess) {
  return { ...OF_THE_THREAD, type, item };
}

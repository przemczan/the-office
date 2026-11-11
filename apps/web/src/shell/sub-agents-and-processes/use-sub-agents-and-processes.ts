import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  threadWebEventSchema,
  withSubAgentOrProcess,
  type SubAgentOrProcess,
  type WebEvent,
} from "@the-office/contracts";
import { threadQueries } from "../../api/conversations.ts";
import { useThreadEvents } from "../../api/event-stream-provider.tsx";

/** The events that carry a whole item as it starts, changes or ends. */
const LIST_EVENT_TYPES = [
  "thread.sub-agent-started",
  "thread.sub-agent-changed",
  "thread.sub-agent-ended",
  "thread.process-started",
  "thread.process-ended",
] as const;

/**
 * The Thread's Sub-agents and Processes, as read, kept live by their start, change and end events
 * for that Thread, and read again once each connection's subscription is in place, as the events
 * sent meanwhile are lost. The line and the view share it. Undefined until it is read.
 */
export function useSubAgentsAndProcesses(
  threadId: string,
): readonly SubAgentOrProcess[] | undefined {
  const queryClient = useQueryClient();
  const { queryKey } = threadQueries.subAgentsAndProcesses(threadId);
  const list = useQuery(threadQueries.subAgentsAndProcesses(threadId)).data;
  useThreadEvents({
    threadId,
    eventTypes: LIST_EVENT_TYPES,
    onEvent: (event) =>
      queryClient.setQueryData(queryKey, (shown) => shown && listWithEvent(shown, event)),
    onSubscribed: () => void queryClient.invalidateQueries({ queryKey, exact: true }),
  });
  return list;
}

/**
 * The list with the item an event carries put in by its `callId`: in any order the events come,
 * an older copy never replaces a newer one. Any other event leaves it as it is.
 */
export function listWithEvent(
  list: readonly SubAgentOrProcess[],
  event: WebEvent,
): SubAgentOrProcess[] {
  const parsed = threadWebEventSchema.safeParse(event);
  if (!parsed.success || !("item" in parsed.data)) return [...list];
  return withSubAgentOrProcess(list, parsed.data.item);
}

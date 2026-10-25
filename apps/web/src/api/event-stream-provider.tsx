import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { EVENTS_PATH, type WebEvent } from "@the-office/contracts";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { EventStream, type EventStreamStatus } from "./event-stream.ts";

/** For each event type the web receives, the queries an event of that type makes stale. */
export type EventInvalidations = Readonly<Record<string, (event: WebEvent) => readonly QueryKey[]>>;

const EventStreamContext = createContext<EventStream | undefined>(undefined);

/**
 * Keeps the queries fresh from the service's domain events while mounted. After a reconnect every
 * query is refetched, since the events sent while the connection was down are lost.
 */
export function EventStreamProvider({
  invalidations,
  children,
}: {
  readonly invalidations: EventInvalidations;
  readonly children: ReactNode;
}): ReactNode {
  const queryClient = useQueryClient();
  const [eventStream] = useState(() => createEventStream(queryClient, invalidations));
  useEffect(() => {
    eventStream.start();
    return () => eventStream.stop();
  }, [eventStream]);
  return <EventStreamContext value={eventStream}>{children}</EventStreamContext>;
}

/** Whether the web is connected to the service's events, or connecting to them again. */
export function useEventStreamStatus(): EventStreamStatus {
  const eventStream = useContext(EventStreamContext);
  if (eventStream === undefined) {
    throw new Error("useEventStreamStatus needs an EventStreamProvider.");
  }
  return useSyncExternalStore(eventStream.subscribe, eventStream.status);
}

function createEventStream(
  queryClient: QueryClient,
  invalidations: EventInvalidations,
): EventStream {
  return new EventStream({
    url: eventsUrl(window.location),
    eventTypes: Object.keys(invalidations),
    onEvent: (event) => {
      for (const queryKey of invalidations[event.type]?.(event) ?? []) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
    onReconnected: () => void queryClient.invalidateQueries(),
  });
}

function eventsUrl(location: Location): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}${EVENTS_PATH}`;
}

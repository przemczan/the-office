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

/**
 * For event types that carry what changed, how an event of that type changes the cached queries in
 * place, refetching nothing; or, for those that name exactly which queries they change, refetching
 * only those, where `EventInvalidations` would take each key as a prefix.
 */
export type EventCacheUpdates = Readonly<
  Record<string, (event: WebEvent, queryClient: QueryClient) => void>
>;

const EventStreamContext = createContext<EventStream | undefined>(undefined);

/**
 * Keeps the queries fresh from the service's domain events while mounted, refetching the ones an
 * event makes stale or changing them in place. Once each connection's subscription is in place,
 * the first one's included, every query is refetched: the events sent before it are lost, and a
 * query read while connecting would otherwise keep what it read for good.
 */
export function EventStreamProvider({
  invalidations,
  cacheUpdates,
  children,
}: {
  readonly invalidations: EventInvalidations;
  readonly cacheUpdates: EventCacheUpdates;
  readonly children: ReactNode;
}): ReactNode {
  const queryClient = useQueryClient();
  const [eventStream] = useState(() => createEventStream(queryClient, invalidations, cacheUpdates));
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
  cacheUpdates: EventCacheUpdates,
): EventStream {
  return new EventStream({
    url: eventsUrl(window.location),
    eventTypes: [...Object.keys(invalidations), ...Object.keys(cacheUpdates)],
    onEvent: (event) => {
      cacheUpdates[event.type]?.(event, queryClient);
      for (const queryKey of invalidations[event.type]?.(event) ?? []) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
    onSubscribed: () => void queryClient.invalidateQueries(),
  });
}

function eventsUrl(location: Location): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}${EVENTS_PATH}`;
}

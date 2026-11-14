import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { EVENTS_PATH, type WebEvent } from "@the-office/contracts";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { EventStream, type EventStreamOptions, type EventStreamStatus } from "./event-stream.ts";

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

/** What a part needs to receive one Thread's events: `EventStream`'s, or a test's own. */
export type ThreadEvents = Pick<EventStream, "subscribeToThread">;

/** Provided by `EventStreamProvider`; a test gives its own to send a Thread's events. */
export const ThreadEventsContext = createContext<ThreadEvents | undefined>(undefined);

/**
 * Keeps the queries fresh from the service's domain events while connected, refetching the ones an
 * event makes stale or changing them in place. It connects only while a part signed in holds
 * `useConnectedEventStream` (the shell, once the account has answered), so no WebSocket opens
 * before signing in. Once each connection's subscription is in place, the first one's included,
 * every query is refetched: the events sent before it are lost, and a query read while connecting
 * would otherwise keep what it read for good. `onSignedOut` is called when the service closes the
 * connection as this device was signed out.
 */
export function EventStreamProvider({
  invalidations,
  cacheUpdates,
  onSignedOut,
  openWebSocket,
  children,
}: {
  readonly invalidations: EventInvalidations;
  readonly cacheUpdates: EventCacheUpdates;
  readonly onSignedOut: () => void;
  /** A test's own WebSocket; the browser's otherwise. */
  readonly openWebSocket?: (url: string) => WebSocket;
  readonly children: ReactNode;
}): ReactNode {
  const queryClient = useQueryClient();
  // Read once, as the invalidations are: the app's never change.
  const [eventStream] = useState(() =>
    createEventStream(queryClient, invalidations, cacheUpdates, {
      onSignedOut,
      ...(openWebSocket && { openWebSocket }),
    }),
  );
  return (
    <EventStreamContext value={eventStream}>
      <ThreadEventsContext value={eventStream}>{children}</ThreadEventsContext>
    </EventStreamContext>
  );
}

/**
 * Receives the event types for one Thread while mounted (`EventStream.subscribeToThread`), the
 * only way to receive a thread-scoped type; `onSubscribed` once per connection, the first one
 * included, for reading again what a lost connection missed. Subscribed again only when the Thread
 * or the types change, so the callbacks may change on every render. Outside a provider, as in a
 * test that renders a part alone, nothing is received.
 */
export function useThreadEvents({
  threadId,
  eventTypes,
  onEvent,
  onSubscribed,
}: {
  readonly threadId: string;
  readonly eventTypes: readonly string[];
  readonly onEvent: (event: WebEvent) => void;
  readonly onSubscribed?: () => void;
}): void {
  const threadEvents = useContext(ThreadEventsContext);
  const latest = useRef({ onEvent, onSubscribed });
  useLayoutEffect(() => {
    latest.current = { onEvent, onSubscribed };
  });
  const types = eventTypes.join(" ");
  useEffect(() => {
    if (threadEvents === undefined) return;
    return threadEvents.subscribeToThread({
      threadId,
      eventTypes: types.split(" "),
      onEvent: (event) => latest.current.onEvent(event),
      onSubscribed: () => latest.current.onSubscribed?.(),
    });
  }, [threadEvents, threadId, types]);
}

/**
 * Connects the event stream while `connected` and this part is mounted, and stops it otherwise.
 * Held by the shell once the account has answered; one holder at a time.
 */
export function useConnectedEventStream(connected: boolean): void {
  const eventStream = useContext(EventStreamContext);
  useEffect(() => {
    if (eventStream === undefined || !connected) return;
    eventStream.start();
    return () => eventStream.stop();
  }, [eventStream, connected]);
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
  connection: Pick<EventStreamOptions, "onSignedOut" | "openWebSocket">,
): EventStream {
  return new EventStream({
    ...connection,
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

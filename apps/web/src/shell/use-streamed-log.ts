import type { WebEvent } from "@the-office/contracts";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useOfficeEvent } from "../api/event-stream-provider.tsx";

/** How often a streaming log is read on, besides each event about what it logs. */
const READ_ON_MS = 1000;

/** The log read so far, of one thing that logs, such as a test instance or an Action run. */
export interface StreamedLog<State> {
  readonly text: string;
  /** The state the last read answered; undefined before the first. */
  readonly state: State | undefined;
  readonly error: Error | undefined;
}

/** One read of a log from a byte offset: what was written since, where to read on, its state. */
export interface LogRead<State> {
  readonly text: string;
  readonly nextOffset: number;
  readonly state: State;
}

/** What a log is read by, and the event that says it changed. */
export interface LogSource<State> {
  /** What is logged, by its id; another id starts the log again from its start. */
  readonly id: string;
  readonly read: (id: string, from: number, signal: AbortSignal) => Promise<LogRead<State>>;
  /** Whether what is logged is still going, so its log may grow. */
  readonly isActive: (state: State) => boolean;
  /** The event type that says it changed, to read on at once. */
  readonly eventType: string;
  /** Whether an event of that type is about this one. */
  readonly isAbout: (event: WebEvent, id: string) => boolean;
}

/**
 * Reads a log from its start, then on from where it is, appending only what is new: each second
 * while it is active and at once on each event about it; once it has ended, until nothing is left
 * to read.
 */
export function useStreamedLog<State>(source: LogSource<State>): StreamedLog<State> {
  const { id, eventType } = source;
  const [read, setRead] = useState<StreamedLog<State> & { readonly id: string }>({
    text: "",
    state: undefined,
    error: undefined,
    id,
  });
  const offset = useRef(0);
  const readOnNow = useRef<() => void>(() => undefined);
  // The latest callbacks, so a caller's new functions on each render don't start the log again.
  const latest = useRef(source);
  useLayoutEffect(() => {
    latest.current = source;
  });

  useEffect(() => {
    offset.current = 0;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reading = false;
    let askedAgain = false;
    let ended = false;

    const readOn = async (): Promise<void> => {
      if (reading) {
        askedAgain = true;
        return;
      }
      clearTimeout(timer);
      reading = true;
      try {
        const answer = await latest.current.read(id, offset.current, controller.signal);
        offset.current = answer.nextOffset;
        ended = !latest.current.isActive(answer.state);
        setRead((shown) => ({
          id,
          text: (shown.id === id ? shown.text : "") + answer.text,
          state: answer.state,
          error: undefined,
        }));
        reading = false;
        // It changed while reading, or more of an ended one's log may wait than one read answers.
        if (askedAgain || (ended && answer.text !== "")) {
          askedAgain = false;
          void readOn();
          return;
        }
      } catch (error) {
        reading = false;
        if (controller.signal.aborted) return;
        setRead((shown) => ({
          ...shown,
          error: error instanceof Error ? error : new Error(String(error)),
        }));
      }
      if (!ended) timer = setTimeout(() => void readOn(), READ_ON_MS);
    };
    readOnNow.current = () => {
      ended = false;
      void readOn();
    };
    void readOn();
    return () => {
      controller.abort();
      clearTimeout(timer);
      readOnNow.current = () => undefined;
    };
  }, [id]);

  const onChanged = useCallback(
    (event: WebEvent) => {
      if (latest.current.isAbout(event, id)) readOnNow.current();
    },
    [id],
  );
  useOfficeEvent(eventType, onChanged);

  return read.id === id ? read : { text: "", state: undefined, error: undefined };
}

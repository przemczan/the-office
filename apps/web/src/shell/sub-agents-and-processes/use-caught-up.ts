import type { WebEvent } from "@the-office/contracts";
import { useEffect, useRef, useState } from "react";
import { useThreadEvents } from "../../api/event-stream-provider.tsx";
import {
  readingAgain,
  startingToRead,
  withPart,
  withRead,
  type CatchUpStep,
  type CaughtUp,
  type Sequenced,
} from "./catch-up.ts";

/** A read of the stream: what came after `after`, up to `lastSequence`. */
export interface StreamRead<Part extends Sequenced> {
  readonly parts: readonly Part[];
  readonly lastSequence: number;
  /** What the service no longer keeps of the stream's start, as the read counts it. */
  readonly earlierNotKept: number;
}

export interface CaughtUpStream<Part extends Sequenced> {
  readonly parts: readonly Part[];
  /** Undefined until the first read answers. */
  readonly earlierNotKept: number | undefined;
  /** Why the last read failed; the next connection, or `readAgain`, reads again. */
  readonly error: Error | null;
  /** Reads again from the last part held, holding what arrives meanwhile, as a reconnect does. */
  readonly readAgain: () => void;
}

/**
 * A Sub-agent's messages or a Process's output, caught up by sequence (spec 2.9, "A page that
 * opens late"): subscribed to for the Thread while mounted, read once each connection's
 * subscription is in place, from the last sequence held, what arrives meanwhile held and applied
 * after the read; a part that skips ahead reads again. Key it by the item, so another starts anew.
 */
export function useCaughtUpStream<Part extends Sequenced>({
  threadId,
  eventType,
  partsOf,
  read,
}: {
  readonly threadId: string;
  readonly eventType: string;
  /** The parts of the item's own an event carries; none for another item's. */
  readonly partsOf: (event: WebEvent) => readonly Part[];
  readonly read: (after: number, signal: AbortSignal) => Promise<StreamRead<Part>>;
}): CaughtUpStream<Part> {
  const [shown, setShown] = useState<CaughtUp<Part>>(startingToRead);
  const [earlierNotKept, setEarlierNotKept] = useState<number | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const held = useRef<CaughtUp<Part>>(shown);
  const reading = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => reading.current?.abort(), []);

  const readFrom = (after: number): void => {
    // Only the latest read counts: the state an earlier one would answer has moved on.
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    void readInto(controller.signal, after);
  };
  const readInto = async (signal: AbortSignal, after: number): Promise<void> => {
    try {
      const answer = await read(after, signal);
      if (signal.aborted) return;
      setError(null);
      setEarlierNotKept(answer.earlierNotKept);
      take(withRead(held.current, answer));
    } catch (failure) {
      if (signal.aborted) return;
      setError(failure instanceof Error ? failure : new Error(String(failure)));
    }
  };
  const take = (step: CatchUpStep<Part>): void => {
    held.current = step.state;
    setShown(step.state);
    if (step.readAfter !== undefined) readFrom(step.readAfter);
  };
  const readAgain = (): void => {
    take({ state: readingAgain(held.current) });
    readFrom(held.current.lastSequence);
  };

  useThreadEvents({
    threadId,
    eventTypes: [eventType],
    onEvent: (event) => {
      for (const part of partsOf(event)) take(withPart(held.current, part));
    },
    onSubscribed: readAgain,
  });
  return { parts: shown.parts, earlierNotKept, error, readAgain };
}

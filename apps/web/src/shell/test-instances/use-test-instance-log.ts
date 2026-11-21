import {
  testInstanceWebEventSchema,
  type TestInstanceState,
  type WebEvent,
} from "@the-office/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOfficeEvent } from "../../api/event-stream-provider.tsx";
import { readTestInstanceLog, TEST_INSTANCE_CHANGED } from "../../api/test-instances.ts";
import { isActive } from "./test-instance-words.ts";

/** How often a streaming log is read on, besides each change of its instance. */
const READ_ON_MS = 1000;

/** The log read so far, of one instance. */
export interface ReadLog {
  readonly text: string;
  /** The state the last read answered; undefined before the first. */
  readonly state: TestInstanceState | undefined;
  readonly error: Error | undefined;
}

const NOTHING_READ: ReadLog = { text: "", state: undefined, error: undefined };

/**
 * Reads an instance's log from its start, then on from where it is, appending only what is new:
 * each second while it is Building or Running and at once on each `test-instance.changed` of it;
 * once it has ended, until nothing is left to read.
 */
export function useTestInstanceLog(instanceId: string): ReadLog {
  const [read, setRead] = useState<ReadLog & { readonly instanceId: string }>({
    ...NOTHING_READ,
    instanceId,
  });
  const offset = useRef(0);
  const readOnNow = useRef<() => void>(() => undefined);

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
        const answer = await readTestInstanceLog(instanceId, offset.current, controller.signal);
        offset.current = answer.nextOffset;
        ended = !isActive(answer.state);
        setRead((shown) => ({
          instanceId,
          text: (shown.instanceId === instanceId ? shown.text : "") + answer.text,
          state: answer.state,
          error: undefined,
        }));
        reading = false;
        // The instance changed while reading, or more of an ended one's log may wait than one
        // read answers.
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
  }, [instanceId]);

  const onChanged = useCallback(
    (event: WebEvent) => {
      const changed = testInstanceWebEventSchema.safeParse(event);
      if (
        changed.success &&
        "instanceId" in changed.data &&
        changed.data.instanceId === instanceId
      ) {
        readOnNow.current();
      }
    },
    [instanceId],
  );
  useOfficeEvent(TEST_INSTANCE_CHANGED, onChanged);

  return read.instanceId === instanceId ? read : NOTHING_READ;
}

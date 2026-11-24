import {
  testInstanceWebEventSchema,
  type TestInstanceState,
  type WebEvent,
} from "@the-office/contracts";
import { readTestInstanceLog, TEST_INSTANCE_CHANGED } from "../../api/test-instances.ts";
import { useStreamedLog, type StreamedLog } from "../use-streamed-log.ts";
import { isActive } from "./test-instance-words.ts";

/** The log read so far, of one instance. */
export type ReadLog = StreamedLog<TestInstanceState>;

function isAbout(event: WebEvent, instanceId: string): boolean {
  const changed = testInstanceWebEventSchema.safeParse(event);
  return changed.success && "instanceId" in changed.data && changed.data.instanceId === instanceId;
}

async function read(instanceId: string, from: number, signal: AbortSignal) {
  const answer = await readTestInstanceLog(instanceId, from, signal);
  return { text: answer.text, nextOffset: answer.nextOffset, state: answer.state };
}

/**
 * Reads an instance's log from its start, then on from where it is, appending only what is new:
 * each second while it is Building or Running and at once on each `test-instance.changed` of it;
 * once it has ended, until nothing is left to read.
 */
export function useTestInstanceLog(instanceId: string): ReadLog {
  return useStreamedLog({
    id: instanceId,
    read,
    isActive,
    eventType: TEST_INSTANCE_CHANGED,
    isAbout,
  });
}

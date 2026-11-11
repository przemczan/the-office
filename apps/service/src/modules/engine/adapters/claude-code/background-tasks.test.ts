import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AsyncChannel } from "../../../../platform/streams/async-channel.js";
import {
  AdapterReading,
  backgroundCommand,
  backgroundEvents,
  COUNTING_OUTPUT,
  RECORDED_EVENTS,
  recordedEvents,
  playRecordedSession,
  taskNotification,
  taskStop,
  type Wire,
} from "./background-tasks.fixtures.js";

/** The stream as the Agent SDK's `query()` yields it to the adapter: the messages themselves. */
function sdkWire(): Wire {
  const channel = new AsyncChannel<SDKMessage>();
  return {
    messages: channel,
    send: (...messages) => {
      for (const each of messages) channel.push(each);
    },
    end: () => channel.close(),
  };
}

describe("BackgroundTasks on the Agent SDK's stream", () => {
  let folder: string;
  let outputFile: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "office-background-tasks-"));
    outputFile = join(folder, "b1f9c2e07.output");
    await writeFile(outputFile, "");
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it("reports a background command with its output in order and whole, a foreground Sub-agent from its call alone, and a background one with what it reported back", async () => {
    const recorded = recordedEvents(await playRecordedSession(sdkWire(), outputFile));

    expect(recorded.inOrder).toEqual(RECORDED_EVENTS);
    expect(recorded.output).toBe(COUNTING_OUTPUT);
    expect(recorded.reads).toBeGreaterThan(1);
    expect(recorded.outputWithinCommand).toBe(true);
  });

  it("reports a command the Agent stopped with TaskStop as stopped by the Agent", async () => {
    const wire = sdkWire();
    const reading = new AdapterReading(wire.messages);

    wire.send(
      ...backgroundCommand("toolu_01Tick", "b2", "while true; do date; sleep 1; done", outputFile),
      ...taskStop("toolu_01Stop", "b2"),
      taskNotification("b2", "toolu_01Tick", "stopped", { output_file: outputFile }),
    );
    await reading.until("process-ended");
    wire.end();

    expect(backgroundEvents(await reading.done).at(-1)).toEqual({
      kind: "process-ended",
      callId: "toolu_01Tick",
      ending: { state: "stopped", by: "agent" },
      exitCode: undefined,
    });
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COUNTING_OUTPUT,
  RECORDED_EVENTS,
  recordedEvents,
  playRecordedSession,
  type Wire,
} from "../claude-code/background-tasks.fixtures.js";
import { StreamJson } from "./stream-json.js";
import { FakeEngine } from "./stream-json.fixtures.js";

/** The stream as the `-p` fallback reads it: stream-json lines on the binary's output. */
function streamJsonWire(): Wire {
  const engine = new FakeEngine();
  const stream = new StreamJson(engine.asChild);
  return {
    messages: stream.messages,
    send: (...messages) => engine.writes(...messages),
    end: () => engine.exits(0),
  };
}

describe("BackgroundTasks on the -p fallback's stream", () => {
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
    const recorded = recordedEvents(await playRecordedSession(streamJsonWire(), outputFile));

    expect(recorded.inOrder).toEqual(RECORDED_EVENTS);
    expect(recorded.output).toBe(COUNTING_OUTPUT);
    expect(recorded.reads).toBeGreaterThan(1);
    expect(recorded.outputWithinCommand).toBe(true);
  });
});

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AsyncChannel } from "../../../../platform/streams/async-channel.js";
import {
  AdapterReading,
  backgroundCommand,
  backgroundEvents,
  taskNotification,
} from "./background-tasks.fixtures.js";
import { message } from "./sdk-events.fixtures.js";

const COMMAND = "npm run dev";

const taskCall = (callId: string, input: Record<string, unknown>, within: string | null = null) =>
  message({
    type: "assistant",
    parent_tool_use_id: within,
    message: {
      id: callId,
      content: [{ type: "tool_use", id: callId, name: "Task", input }],
      usage: USAGE,
    },
  });

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 };

const result = (callId: string, content: unknown, isError = false, structured?: unknown) =>
  message({
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: callId, content, is_error: isError }],
    },
    tool_use_result: structured,
  });

const system = (fields: Record<string, unknown>) =>
  message({ type: "system", uuid: "u", session_id: "session", ...fields });

describe("BackgroundTasks", () => {
  let folder: string;
  let outputFile: string;
  let wire: AsyncChannel<SDKMessage>;
  let reading: AdapterReading;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "office-background-tasks-"));
    outputFile = join(folder, "b1.output");
    await writeFile(outputFile, "");
    wire = new AsyncChannel<SDKMessage>();
    reading = new AdapterReading(wire);
  });

  afterEach(async () => {
    wire.close();
    await reading.done;
    await rm(folder, { recursive: true, force: true });
  });

  const send = (...messages: SDKMessage[]) => {
    for (const each of messages) wire.push(each);
  };
  const ended = async () => {
    wire.close();
    return backgroundEvents(await reading.done);
  };

  it("reports a command stopped after an interrupt as stopped by the interrupt", async () => {
    send(...backgroundCommand("c1", "b1", COMMAND, outputFile));
    await reading.until("process-started");
    reading.background.interrupted();
    send(taskNotification("b1", "c1", "stopped"));
    await reading.until("process-ended");

    expect((await ended()).at(-1)).toMatchObject({ ending: { state: "stopped", by: "interrupt" } });
  });

  it("reports a command stopped by the engine's restart as stopped with the session", async () => {
    send(
      ...backgroundCommand("c1", "b1", COMMAND, outputFile),
      taskNotification("b1", "c1", "stopped", { reason: "worker_restart" }),
    );
    await reading.until("process-ended");

    expect((await ended()).at(-1)).toMatchObject({
      ending: { state: "stopped", by: "session-end" },
    });
  });

  it("reports a failed command with the engine's summary, and an exit code only when the summary names one", async () => {
    send(
      ...backgroundCommand("c1", "b1", COMMAND, outputFile),
      taskNotification("b1", "c1", "failed", { summary: "Command failed (exit code 2)" }),
    );
    await reading.until("process-ended");
    send(
      ...backgroundCommand("c2", "b2", COMMAND, join(folder, "b2.output")),
      taskNotification("b2", "c2", "failed", { summary: "Command failed" }),
    );
    await reading.until("process-ended", 2);

    const ends = (await ended()).filter(({ kind }) => kind === "process-ended");
    expect(ends).toEqual([
      {
        kind: "process-ended",
        callId: "c1",
        ending: { state: "failed", reason: "Command failed (exit code 2)" },
        exitCode: 2,
      },
      {
        kind: "process-ended",
        callId: "c2",
        ending: { state: "failed", reason: "Command failed" },
        exitCode: undefined,
      },
    ]);
  });

  it("ends a command stopped once it leaves the engine's live tasks with no end, and only once", async () => {
    send(
      ...backgroundCommand("c1", "b1", COMMAND, outputFile),
      system({ subtype: "background_tasks_changed", tasks: [] }),
    );
    await reading.until("process-ended");
    send(taskNotification("b1", "c1", "completed"));

    const ends = (await ended()).filter(({ kind }) => kind === "process-ended");
    expect(ends).toEqual([
      {
        kind: "process-ended",
        callId: "c1",
        ending: { state: "stopped", by: "agent" },
        exitCode: undefined,
      },
    ]);
  });

  it("weighs only a command the live tasks listed once, as a list may lag behind a start", async () => {
    send(
      system({ subtype: "background_tasks_changed", tasks: [] }),
      ...backgroundCommand("c1", "b1", COMMAND, outputFile).filter(
        (each) => !("subtype" in each && each.subtype === "background_tasks_changed"),
      ),
      system({ subtype: "background_tasks_changed", tasks: [] }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(reading.events.some(({ kind }) => kind === "process-ended")).toBe(false);
  });

  it("ends what still runs with the session, after a last read of its output", async () => {
    send(
      ...backgroundCommand("c1", "b1", COMMAND, outputFile),
      taskCall("t1", { description: "Look", prompt: "Look around.", subagent_type: "Explore" }),
    );
    await reading.until("sub-agent-started");
    await appendFile(outputFile, "ready\n");

    const events = await ended();
    expect(events.filter(({ kind }) => kind !== "process-output").slice(-2)).toEqual([
      {
        kind: "sub-agent-ended",
        callId: "t1",
        ending: { state: "stopped", by: "session-end" },
        reportedBack: undefined,
        toolCallCount: undefined,
        totalTokens: undefined,
      },
      {
        kind: "process-ended",
        callId: "c1",
        ending: { state: "stopped", by: "session-end" },
        exitCode: undefined,
      },
    ]);
    const output = events.flatMap((event) => (event.kind === "process-output" ? [event.text] : []));
    expect(output.join("")).toBe("ready\n");
  });

  it("reports a stop the engine gives while the session ends as stopped with the session", async () => {
    send(...backgroundCommand("c1", "b1", COMMAND, outputFile));
    reading.background.ending();
    send(taskNotification("b1", "c1", "stopped"));
    await reading.until("process-ended");

    expect((await ended()).at(-1)).toMatchObject({
      ending: { state: "stopped", by: "session-end" },
    });
  });

  it("reports a foreground Sub-agent whose call failed as failed with its result, or stopped by an interrupt", async () => {
    send(
      taskCall("t1", { description: "Look", prompt: "Look around." }),
      result("t1", "The agent hit an error.", true),
    );
    await reading.until("sub-agent-ended");
    send(taskCall("t2", { description: "Look again", prompt: "Look again." }));
    await reading.until("sub-agent-started", 2);
    reading.background.interrupted();
    send(result("t2", "[Request interrupted by user for tool use]", true));
    await reading.until("sub-agent-ended", 2);

    const ends = (await ended()).filter(({ kind }) => kind === "sub-agent-ended");
    expect(
      ends.map((event) => (event.kind === "sub-agent-ended" ? event.ending : undefined)),
    ).toEqual([
      { state: "failed", reason: "The agent hit an error." },
      { state: "stopped", by: "interrupt" },
    ]);
  });

  it("ends a foreground Sub-agent once, by its notification or its result, whichever comes first", async () => {
    send(
      taskCall("t1", { description: "Look", prompt: "Look around.", run_in_background: false }),
      system({
        subtype: "task_started",
        task_id: "a1",
        tool_use_id: "t1",
        description: "Look",
        task_type: "local_agent",
        is_backgrounded: false,
      }),
      taskNotification("a1", "t1", "completed", { summary: "Found it." }),
      result("t1", "Found it.", false, {
        status: "completed",
        content: [],
        totalToolUseCount: 2,
        totalTokens: 9,
      }),
    );
    await reading.until("sub-agent-ended");

    const ends = (await ended()).filter(({ kind }) => kind === "sub-agent-ended");
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ ending: { state: "finished" }, reportedBack: "Found it." });
  });

  it("names the Sub-agent that started a Sub-agent or a command", async () => {
    send(
      taskCall("t1", { description: "Look", prompt: "Look around." }),
      system({
        subtype: "task_started",
        task_id: "a1",
        tool_use_id: "t1",
        description: "Look",
        task_type: "local_agent",
      }),
      taskCall("t2", { description: "Dig", prompt: "Dig deeper." }, "t1"),
      message({
        type: "assistant",
        parent_tool_use_id: "t1",
        message: {
          id: "m2",
          content: [
            {
              type: "tool_use",
              id: "c1",
              name: "Bash",
              input: { command: COMMAND, run_in_background: true },
            },
          ],
          usage: USAGE,
        },
      }),
      system({
        subtype: "task_started",
        task_id: "b1",
        tool_use_id: "c1",
        description: "Run it",
        task_type: "local_bash",
        is_backgrounded: true,
        parent_task_id: "a1",
      }),
    );
    await reading.until("process-started");

    const events = await ended();
    expect(events.find(({ callId }) => callId === "t2")).toMatchObject({ withinToolCall: "t1" });
    expect(events.find(({ kind }) => kind === "process-started")).toMatchObject({
      callId: "c1",
      withinToolCall: "t1",
      commandLine: COMMAND,
    });
  });

  it("leaves out a command the Agent waits on until the engine moves it to the background, and ambient tasks", async () => {
    send(
      message({
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          id: "m1",
          content: [{ type: "tool_use", id: "c1", name: "Bash", input: { command: COMMAND } }],
          usage: USAGE,
        },
      }),
      system({
        subtype: "task_started",
        task_id: "b1",
        tool_use_id: "c1",
        description: "Run it",
        task_type: "local_bash",
        is_backgrounded: false,
      }),
      system({
        subtype: "task_started",
        task_id: "w1",
        description: "Watch the files",
        task_type: "local_bash",
        ambient: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reading.events.some(({ kind }) => kind === "process-started")).toBe(false);

    send(system({ subtype: "task_updated", task_id: "b1", patch: { is_backgrounded: true } }));
    await reading.until("process-started");

    expect(reading.events.find(({ kind }) => kind === "process-started")).toMatchObject({
      callId: "c1",
      engineTaskId: "b1",
      commandLine: COMMAND,
    });
  });
});

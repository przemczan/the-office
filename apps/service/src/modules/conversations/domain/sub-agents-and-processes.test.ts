import { describe, expect, it } from "vitest";
import {
  changeSubAgent,
  endItem,
  outputTrim,
  progressSubAgent,
  RESTART_ENDING,
  stateOf,
  WholeLines,
  type Process,
  type SubAgent,
} from "./sub-agents-and-processes.js";

const AT = new Date("2026-11-11T09:00:00Z");
const LATER = new Date("2026-11-11T09:05:00Z");

const A_PROCESS: Process = {
  kind: "process",
  threadId: "thread",
  sessionId: "session",
  callId: "bash-1",
  engineTaskId: "b1f9c2e07",
  startedBy: undefined,
  description: "Serve the app",
  commandLine: "npm run dev",
  ending: undefined,
  exitCode: undefined,
  startedAt: AT,
  endedAt: undefined,
  revision: 0,
  lastSequence: 0,
  earlierOutputNotKept: 0,
};

const A_SUB_AGENT: SubAgent = {
  kind: "sub-agent",
  threadId: "thread",
  sessionId: "session",
  callId: "agent-1",
  engineTaskId: undefined,
  startedBy: undefined,
  description: "Look it up",
  agentKind: "Explore",
  prompt: "Find it.",
  background: false,
  ending: undefined,
  reportedBack: undefined,
  toolCallCount: undefined,
  totalTokens: undefined,
  startedAt: AT,
  endedAt: undefined,
  revision: 0,
  lastSequence: 0,
  earlierMessagesNotKept: 0,
};

describe("a Sub-agent's or a Process's state", () => {
  it("is Running until it ends, then as it ended, a revision on", () => {
    const ended = endItem(A_PROCESS, { state: "failed", reason: "Exited with code 1" }, LATER, {
      exitCode: 1,
    });

    expect(stateOf(A_PROCESS)).toBe("running");
    expect(ended).toMatchObject({ endedAt: LATER, exitCode: 1, revision: 1 });
    expect(ended && stateOf(ended)).toBe("failed");
  });

  it("only moves forward: one already ended stays as it ended", () => {
    const finished = endItem(A_PROCESS, { state: "finished" }, AT);
    if (!finished) throw new Error("It didn't end.");

    expect(endItem(finished, RESTART_ENDING, LATER)).toBeUndefined();
    expect(endItem(finished, { state: "stopped", by: "session-end" }, LATER)).toBeUndefined();
  });

  it("takes what the engine tells of a Sub-agent later, even once it ended, and changes nothing twice", () => {
    const ended = endItem(A_SUB_AGENT, { state: "finished" }, AT, { reportedBack: "Found." });
    if (!ended) throw new Error("It didn't end.");

    const changed = changeSubAgent(ended, { engineTaskId: "a1", background: false });

    expect(changed).toMatchObject({
      engineTaskId: "a1",
      ending: { state: "finished" },
      revision: 2,
    });
    expect(changed && changeSubAgent(changed, { engineTaskId: undefined, background: false })).toBe(
      undefined,
    );
  });

  it("takes a running Sub-agent's context size as a revision, and keeps it through an end that gives none", () => {
    const progressed = progressSubAgent(A_SUB_AGENT, 2_100);
    if (!progressed) throw new Error("It didn't change.");

    expect(progressed).toMatchObject({ totalTokens: 2_100, revision: 1 });
    expect(progressSubAgent(progressed, 2_100)).toBeUndefined();
    const ended = endItem(progressed, { state: "stopped", by: "interrupt" }, LATER, {
      totalTokens: undefined,
    });
    expect(ended).toMatchObject({ totalTokens: 2_100, revision: 2 });
    expect(endItem(progressed, { state: "finished" }, LATER, { totalTokens: 3_000 })).toMatchObject(
      { totalTokens: 3_000 },
    );
    expect(ended && progressSubAgent(ended, 4_000)).toBeUndefined();
  });
});

describe("WholeLines", () => {
  it("hands on complete lines, holding an unfinished last line until its newline comes", () => {
    const lines = new WholeLines();

    expect(lines.push("ready\nkey=s3")).toBe("ready\n");
    expect(lines.holding).toBe(true);
    expect(lines.push("cr")).toBe("");
    expect(lines.push("et\nGET /\n")).toBe("key=s3cret\nGET /\n");
    expect(lines.holding).toBe(false);
  });

  it("gives what it holds on a flush, once", () => {
    const lines = new WholeLines();
    lines.push("50% done");

    expect(lines.flush()).toBe("50% done");
    expect(lines.flush()).toBe("");
    expect(lines.push("\n")).toBe("\n");
  });
});

describe("outputTrim", () => {
  it("drops nothing within the limit", () => {
    expect(outputTrim([{ sequence: 1, text: "abc" }], 3)).toEqual({
      droppedSequences: [],
      shortened: undefined,
      droppedBytes: 0,
    });
  });

  it("drops the earliest whole chunks, then cuts the first kept at its head, to the limit exactly", () => {
    const trim = outputTrim(
      [
        { sequence: 1, text: "aaaa\n" },
        { sequence: 2, text: "bbbb\n" },
        { sequence: 3, text: "cccc\n" },
      ],
      8,
    );

    expect(trim).toEqual({
      droppedSequences: [1],
      shortened: { sequence: 2, text: "bb\n" },
      droppedBytes: 7,
    });
  });

  it("never splits a character, keeping a little less instead", () => {
    // "é" is two bytes: keeping 3 bytes of "éé" would split the first.
    const trim = outputTrim([{ sequence: 1, text: "éé" }], 3);

    expect(trim).toEqual({
      droppedSequences: [],
      shortened: { sequence: 1, text: "é" },
      droppedBytes: 2,
    });
  });
});

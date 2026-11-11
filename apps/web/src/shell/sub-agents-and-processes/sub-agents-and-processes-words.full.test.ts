import { describe, expect, it } from "vitest";
import { clockOf } from "../time.ts";
import {
  aProcess,
  aSubAgent,
  endedAfter,
  STARTED_AT,
} from "./sub-agents-and-processes.fixtures.ts";
import {
  earlierMessagesWords,
  earlierOutputWords,
  endingStrip,
  lineText,
  lineWords,
  listGroups,
  secondLine,
  type LineWords,
} from "./sub-agents-and-processes-words.ts";

const failed = (reason = "") =>
  ({ state: "failed", ending: { state: "failed", reason }, endedAt: endedAfter(190_000) }) as const;
const finished = {
  state: "finished",
  ending: { state: "finished" },
  endedAt: endedAfter(60_000),
} as const;

function stoppedBy(by: "agent" | "interrupt" | "session-end" | "restart"): string | undefined {
  return endingStrip(
    aProcess({ state: "stopped", ending: { state: "stopped", by }, endedAt: endedAfter(60_000) }),
  )?.words;
}

function said(words: LineWords | undefined): string | undefined {
  return words && lineText(words);
}

describe("the line", () => {
  it("isn't there while the session has had none", () => {
    expect(lineWords([])).toBeUndefined();
  });

  it("says what runs, how many ended and how many failed", () => {
    const words = lineWords([
      aSubAgent({ callId: "a" }),
      aSubAgent({ callId: "b" }),
      aProcess({ callId: "c" }),
      aSubAgent({ callId: "d", ...finished }),
      aProcess({ callId: "e", ...finished }),
      aProcess({ callId: "f", ...failed() }),
    ]);
    expect(said(words)).toBe("2 sub-agents, 1 process running · 3 ended, 1 failed");
    expect(words?.live).toBe(true);
    expect(words?.pieces.find(({ look }) => look === "failed")?.text).toBe("1 failed");
  });

  it("says one in the singular and leaves out a kind with none", () => {
    expect(said(lineWords([aSubAgent()]))).toBe("1 sub-agent running");
    expect(said(lineWords([aProcess()]))).toBe("1 process running");
  });

  it("says how many ended once none runs, without the live dot", () => {
    const words = lineWords([
      aSubAgent({ callId: "a", ...finished }),
      aSubAgent({ callId: "b", ...finished }),
      aSubAgent({ callId: "c", ...finished }),
      aProcess({ callId: "d", ...finished }),
    ]);
    expect(said(words)).toBe("3 sub-agents, 1 process ended");
    expect(words?.live).toBe(false);
    expect(said(lineWords([aProcess({ ...failed() })]))).toBe("1 process ended · 1 failed");
  });
});

describe("the list", () => {
  it("puts what runs on top, then what ended, the one that ended last first", () => {
    const early = aProcess({ callId: "early", ...finished, endedAt: endedAfter(1000) });
    const late = aProcess({ callId: "late", ...finished, endedAt: endedAfter(9000) });
    const running = aSubAgent({ callId: "running" });
    const groups = listGroups([early, running, late]);
    expect(groups.running).toEqual([running]);
    expect(groups.ended).toEqual([late, early]);
  });

  it("gives each item its kind, state and how long it ran", () => {
    const now = new Date(Date.parse(STARTED_AT) + 72_000);
    expect(secondLine(aSubAgent(), now)).toBe("Sub-agent · Explore · Running · 1m 12s");
    expect(secondLine(aProcess({ ...failed(), exitCode: 1 }), now)).toBe(
      "Process · Failed · exit code 1 · 3m 10s",
    );
    expect(secondLine(aProcess({ ...failed() }), now)).toBe("Process · Failed · 3m 10s");
    const stopped = { state: "stopped", endedAt: endedAfter(5000) } as const;
    expect(
      secondLine(aProcess({ ...stopped, ending: { state: "stopped", by: "agent" } }), now),
    ).toBe("Process · Stopped by the Agent · 5s");
    expect(
      secondLine(aProcess({ ...stopped, ending: { state: "stopped", by: "restart" } }), now),
    ).toBe("Process · Stopped · ended when The Office restarted · 5s");
  });
});

describe("how it ended", () => {
  const at = clockOf(endedAfter(60_000));

  it("names the exit code only where the engine gives one", () => {
    expect(endingStrip(aProcess({ ...finished, exitCode: 0 }))?.words).toBe(
      `Finished with exit code 0 at ${at}.`,
    );
    expect(endingStrip(aProcess({ ...failed(), exitCode: null }))).toEqual({
      tone: "failed",
      words: `Failed at ${clockOf(endedAfter(190_000))}.`,
    });
  });

  it("says why a Sub-agent failed, and gives one that finished no strip", () => {
    expect(endingStrip(aSubAgent({ ...failed("Its context window filled.") }))?.words).toBe(
      `Failed at ${clockOf(endedAfter(190_000))}. Its context window filled.`,
    );
    expect(endingStrip(aSubAgent({ ...finished }))).toBeUndefined();
    expect(endingStrip(aSubAgent())).toBeUndefined();
  });

  it("says what stopped it", () => {
    expect(stoppedBy("agent")).toBe(`Stopped by the Agent at ${at} (TaskStop).`);
    expect(stoppedBy("interrupt")).toBe(`Stopped when the turn was interrupted at ${at}.`);
    expect(stoppedBy("session-end")).toBe(`Stopped with the session at ${at}.`);
    expect(stoppedBy("restart")).toBe(
      `Ended when The Office restarted, at ${at}. It may still be running on the machine.`,
    );
  });
});

describe("what isn't kept", () => {
  it("says how much earlier output was dropped", () => {
    expect(earlierOutputWords(0)).toBeUndefined();
    expect(earlierOutputWords(Math.round(1.9 * 1024 * 1024))).toBe(
      "1.9 MB of earlier output isn't kept. The last 256 KB show here.",
    );
  });

  it("says how many earlier messages were dropped", () => {
    expect(earlierMessagesWords(0)).toBeUndefined();
    expect(earlierMessagesWords(1)).toBe("1 earlier message or tool call isn't kept.");
    expect(earlierMessagesWords(12)).toBe("12 earlier messages and tool calls aren't kept.");
  });
});

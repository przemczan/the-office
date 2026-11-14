import { describe, expect, it } from "vitest";
import { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import {
  SESSION_START_SILENCE_MS,
  SessionStartWatch,
  type WatchedSessionStart,
} from "./session-start-watch.js";

const STARTED = new Date("2026-11-14T21:09:00Z");

const START: WatchedSessionStart = {
  threadId: "thread-1",
  sessionId: "session-1",
  engineId: "claude-code",
  personName: "Angela",
  move: "start",
};

/** The service log's lines, by level. */
class LogLines {
  readonly lines: { readonly level: "log" | "warn" | "error"; readonly text: string }[] = [];

  log(text: string): void {
    this.lines.push({ level: "log", text });
  }

  warn(text: string): void {
    this.lines.push({ level: "warn", text });
  }

  error(text: string): void {
    this.lines.push({ level: "error", text });
  }
}

function watching(start: WatchedSessionStart = START) {
  const schedule = new ManualSchedule();
  schedule.setTime(STARTED);
  const log = new LogLines();
  const watch = new SessionStartWatch(start, schedule, log);
  return { schedule, log, watch };
}

describe("SessionStartWatch", () => {
  it("logs the session as it starts or resumes, with its Thread, engine and person", () => {
    expect(watching().log.lines).toEqual([
      {
        level: "log",
        text: "Thread thread-1 starts session session-1 on the engine claude-code for Angela.",
      },
    ]);
    expect(watching({ ...START, move: "resume" }).log.lines[0]?.text).toBe(
      "Thread thread-1 resumes session session-1 on the engine claude-code for Angela.",
    );
  });

  it("warns once of a session silent for the set time, naming the step it is in", async () => {
    const { schedule, log, watch } = watching();
    watch.at("refreshing the Thread's folders");
    await schedule.advanceBy(SESSION_START_SILENCE_MS - 1);
    expect(log.lines).toHaveLength(1);
    await schedule.advanceBy(1);
    await schedule.advanceBy(SESSION_START_SILENCE_MS);
    expect(log.lines.slice(1)).toEqual([
      {
        level: "warn",
        text: "Thread thread-1's session session-1 (Angela) has given no event 180 s after it was started; it is refreshing the Thread's folders.",
      },
    ]);
  });

  it("says when a session it warned of speaks after all", async () => {
    const { schedule, log, watch } = watching();
    await schedule.advanceBy(SESSION_START_SILENCE_MS + 45_000);
    watch.spoke();
    watch.spoke();
    expect(log.lines.slice(2)).toEqual([
      { level: "log", text: "Thread thread-1's session session-1 spoke after 225 s." },
    ]);
  });

  it("logs nothing more of a session that speaks in time", async () => {
    const { schedule, log, watch } = watching();
    watch.spoke();
    await schedule.advanceBy(SESSION_START_SILENCE_MS * 2);
    expect(log.lines).toHaveLength(1);
  });

  it("logs nothing more of a session that ends before it speaks", async () => {
    const { schedule, log, watch } = watching();
    watch.ended();
    await schedule.advanceBy(SESSION_START_SILENCE_MS * 2);
    expect(log.lines).toHaveLength(1);
  });

  it("logs a failed opening with the step that failed, and warns no more", async () => {
    const { schedule, log, watch } = watching({ ...START, move: "resume" });
    watch.at("preparing MCP servers");
    watch.failed(new Error("The MCP server didn't answer."));
    watch.failed(new Error("Again."));
    await schedule.advanceBy(SESSION_START_SILENCE_MS * 2);
    expect(log.lines.slice(1)).toEqual([
      {
        level: "error",
        text: "Thread thread-1's session session-1 (Angela) failed to resume while preparing MCP servers: The MCP server didn't answer.",
      },
    ]);
  });
});

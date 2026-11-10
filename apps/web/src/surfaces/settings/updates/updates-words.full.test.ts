import { describe, expect, it } from "vitest";
import { lastResultWords, waitingWords } from "./updates-words.ts";

describe("Settings › Updates' words", () => {
  it("tells how the last update ended", () => {
    const commits = {
      from: "1234567aaaa",
      to: "89abcdefbbb",
      finishedAt: "2026-11-03T10:00:00.000Z",
    };

    expect(lastResultWords({ outcome: "updated", ...commits })).toBe(
      "The Office updated to 89abcde.",
    );
    expect(lastResultWords({ outcome: "failed", failedStep: "install", ...commits })).toBe(
      "The Office's update failed at installing (npm ci); it is back on 1234567.",
    );
  });

  it("counts what the scheduled update waits for", () => {
    expect(waitingWords(1)).toBe("Waiting for 1 thing:");
    expect(waitingWords(3)).toBe("Waiting for 3 things:");
    expect(waitingWords(0)).toBe("Nothing is busy, so The Office is restarting for it.");
  });
});

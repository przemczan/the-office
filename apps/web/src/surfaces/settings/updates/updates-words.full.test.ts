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

  it("tells a release's update by its versions, whole, with its steps", () => {
    const versions = { from: "1.3.0", to: "1.4.0", finishedAt: "2026-11-15T10:00:00.000Z" };

    expect(lastResultWords({ outcome: "updated", ...versions })).toBe(
      "The Office updated to 1.4.0.",
    );
    expect(lastResultWords({ outcome: "failed", failedStep: "start", ...versions })).toBe(
      "The Office's update failed at starting the new version; it is back on 1.3.0.",
    );
    expect(
      lastResultWords({
        outcome: "failed",
        failedStep: "start",
        rollbackFailed: true,
        ...versions,
      }),
    ).toBe(
      "The Office's update failed at starting the new version, and going back to 1.3.0 failed too.",
    );
  });

  it("counts what the scheduled update waits for", () => {
    expect(waitingWords(1)).toBe("Waiting for 1 thing:");
    expect(waitingWords(3)).toBe("Waiting for 3 things:");
    expect(waitingWords(0)).toBe("Nothing is busy, so The Office is restarting for it.");
  });
});

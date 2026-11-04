import type { StageRun, TaskStage, Thread } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { NO_TOKENS } from "../../shell/token-words.ts";
import {
  chapterWork,
  chaptersStartingOpen,
  foldedLine,
  threadsInOrder,
  withChapterOpen,
  withChaptersStarted,
} from "./timeline-words.ts";

function aThread(id: string, startedAt: string, fields: Partial<Thread> = {}): Thread {
  return { id, startedAt, tokens: NO_TOKENS, ...fields } as Thread;
}

function aRun(threadId: string | null, startedAt: string, handoverNote: string | null): StageRun {
  return {
    threadId,
    startedAt,
    outcome: {
      status: "failed",
      error: "No.",
      budgetReached: null,
      interrupted: null,
      handoverNote,
    },
  } as StageRun;
}

function aStage(name: string, runs: StageRun[]): TaskStage {
  return { stage: { key: name.toLowerCase(), name }, runs } as unknown as TaskStage;
}

describe("threadsInOrder", () => {
  it("goes by when each Thread started, whatever order they came in", () => {
    const planning = aThread("planning", "2026-11-04T09:00:00.000Z");
    const implement = aThread("implement", "2026-11-04T10:00:00.000Z");
    const consultation = aThread("consultation", "2026-11-04T10:05:00.000Z");
    expect(threadsInOrder([consultation, planning, implement]).map(({ id }) => id)).toEqual([
      "planning",
      "implement",
      "consultation",
    ]);
  });
});

describe("which chapters start unfolded", () => {
  it("is the Thread the user is on and those holding an open Decision", () => {
    expect([...chaptersStartingOpen("on", new Set(["waiting"]))]).toEqual(["on", "waiting"]);
    expect([...chaptersStartingOpen(undefined, new Set())]).toEqual([]);
  });

  it("leaves every other Thread folded", () => {
    const folds = withChaptersStarted(new Map(), chaptersStartingOpen("on", new Set()));
    expect(folds.get("on")).toBe(true);
    expect(folds.get("other")).toBeUndefined();
  });

  it("keeps a chapter open once its Decision is answered, so nothing folds under the reader", () => {
    const opened = withChaptersStarted(new Map(), new Set(["on", "waiting"]));
    const after = withChaptersStarted(opened, new Set(["on"]));
    expect(after).toBe(opened);
    expect(after.get("waiting")).toBe(true);
  });

  it("keeps a chapter the user folded folded, though its Decision still waits", () => {
    const folded = withChapterOpen(new Map(), "waiting", false);
    expect(withChaptersStarted(folded, new Set(["waiting"])).get("waiting")).toBe(false);
  });
});

describe("chapterWork", () => {
  it("takes every Stage a Thread ran in and the latest Handover note of its runs", () => {
    const stages = [
      aStage("Implement", [
        aRun("spanning", "2026-11-04T10:00:00.000Z", "First note."),
        aRun("other", "2026-11-04T10:10:00.000Z", "Not this Thread's."),
      ]),
      aStage("Tests", [aRun(null, "2026-11-04T10:20:00.000Z", null)]),
      aStage("Fix", [aRun("spanning", "2026-11-04T10:30:00.000Z", "Latest note.")]),
    ];
    expect(chapterWork(stages, "spanning")).toEqual({
      stages: [
        { key: "implement", name: "Implement" },
        { key: "fix", name: "Fix" },
      ],
      handoverNote: "Latest note.",
    });
  });

  it("finds nothing for a Consultation, which has no run", () => {
    const stages = [aStage("Implement", [aRun("asker", "2026-11-04T10:00:00.000Z", "Note.")])];
    expect(chapterWork(stages, "consultation")).toEqual({
      stages: [],
      handoverNote: undefined,
    });
  });
});

describe("foldedLine", () => {
  const thread = aThread("one", "2026-11-04T10:00:00.000Z", {
    tokens: { ...NO_TOKENS, input: 12_000, cacheRead: 900_000 },
  });

  it("counts tokens without cache reads, then the Handover note on one line, as plain words", () => {
    expect(foldedLine(thread, "## Redirect\n\n- It keeps `next`.\n- **Tested**.")).toBe(
      "12k tokens · Redirect It keeps next. Tested.",
    );
  });

  it("is only the tokens without a Handover note", () => {
    expect(foldedLine(thread, undefined)).toBe("12k tokens");
  });
});

import type { StageRun, TaskStage, Thread } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { NO_TOKENS } from "../../shell/token-words.ts";
import {
  chapterPlace,
  chapterWork,
  foldedLine,
  threadsInOrder,
  withChapterOpen,
  withChaptersStarted,
} from "./timeline-words.ts";

function aThread(id: string, startedAt: string, fields: Partial<Thread> = {}): Thread {
  return { id, startedAt, tokens: NO_TOKENS, ...fields } as Thread;
}

function aRun(threadId: string | null, id: string, number: number): StageRun {
  return { id, number, threadId, outcome: null } as StageRun;
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
  it("leaves every other Thread folded", () => {
    const folds = withChaptersStarted(new Map(), new Set(["on"]));
    expect(folds.get("on")).toBe(true);
    expect(folds.get("other")).toBeUndefined();
  });

  it("keeps a chapter open once the user moved on, so nothing folds under the reader", () => {
    const opened = withChaptersStarted(new Map(), new Set(["on", "before"]));
    const after = withChaptersStarted(opened, new Set(["on"]));
    expect(after).toBe(opened);
    expect(after.get("before")).toBe(true);
  });

  it("keeps a chapter the user folded folded", () => {
    const folded = withChapterOpen(new Map(), "on", false);
    expect(withChaptersStarted(folded, new Set(["on"])).get("on")).toBe(false);
  });
});

describe("chapterWork", () => {
  it("takes the latest of a Thread's runs, across Stages", () => {
    const stages = [
      aStage("Implement", [aRun("spanning", "first", 1), aRun("other", "not-this", 2)]),
      aStage("Tests", [aRun(null, "a-command", 1)]),
      aStage("Fix", [aRun("spanning", "latest", 3)]),
    ];
    expect(chapterWork(stages, "spanning")).toEqual({
      runNumber: 3,
      runId: "latest",
      finishedRuns: [],
    });
  });

  it("finds nothing for a Consultation, which has no run", () => {
    const stages = [aStage("Implement", [aRun("asker", "run", 1)])];
    expect(chapterWork(stages, "consultation")).toEqual({
      runNumber: undefined,
      runId: undefined,
      finishedRuns: [],
    });
  });
});

describe("foldedLine", () => {
  it("counts tokens without cache reads", () => {
    const thread = aThread("one", "2026-11-04T10:00:00.000Z", {
      tokens: { ...NO_TOKENS, input: 12_000, cacheRead: 900_000 },
    });
    expect(foldedLine(thread)).toBe("12k tokens");
  });
});

describe("chapterPlace", () => {
  it("says which run of the Thread", () => {
    const thread = aThread("implement", "2026-11-04T10:00:00.000Z", { title: "Implement" });
    const work = chapterWork([aStage("Implement", [aRun("implement", "run", 3)])], "implement");
    expect(chapterPlace(thread, work)).toBe("Implement, run 3");
  });
});

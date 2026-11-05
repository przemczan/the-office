import { describe, expect, it } from "vitest";
import type { Stage } from "../domain/stage.js";
import type { StageRun } from "../domain/stage-run.js";
import type { StageRunRepository } from "../ports/stage-run-repository.js";
import type { TaskStagesRepository } from "../ports/task-stages-repository.js";
import { StageResultWords } from "./stage-result-words.js";

const stages = [
  { key: "implement", kind: "agent", name: "Implement", role: "oscar" },
  { key: "review", kind: "agent", name: "Review", role: "rui" },
  { key: "gate", kind: "gate", name: "Gate" },
] as unknown as readonly Stage[];

function aRun(stageKey: string, summary: string, handoverNote: string): StageRun {
  const outcome = { status: "done", summary, handoverNote };
  return { stageKey, outcome } as unknown as StageRun;
}

function wordsOf(runs: readonly StageRun[]): StageResultWords {
  return new StageResultWords(
    { list: () => Promise.resolve(runs) } as unknown as StageRunRepository,
    { find: () => Promise.resolve({ stages }) } as unknown as TaskStagesRepository,
  );
}

describe("a Task's Stage results, for a person's Thread", () => {
  it("words every run's result and keeps only the person's Handover notes", async () => {
    const words = wordsOf([
      aRun("implement", "Fixed it.", "Left: the logout page."),
      aRun("review", "Looks right.", "Left: nothing."),
    ]);

    await expect(words.of("task", "oscar")).resolves.toEqual({
      lines: [
        "- Implement (Agent Stage): done. Fixed it.",
        "- Review (Agent Stage): done. Looks right.",
      ],
      handoverNotes: ["Left: the logout page."],
    });
  });

  it("is empty before any Stage ran", async () => {
    await expect(wordsOf([]).of("task", "oscar")).resolves.toEqual({
      lines: [],
      handoverNotes: [],
    });
  });
});

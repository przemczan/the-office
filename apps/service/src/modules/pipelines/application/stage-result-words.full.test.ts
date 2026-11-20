import { describe, expect, it } from "vitest";
import type { Stage } from "../domain/stage.js";
import type { StageRun } from "../domain/stage-run.js";
import type { StageRunRepository } from "../ports/stage-run-repository.js";
import type { TaskStagesRepository } from "../ports/task-stages-repository.js";
import { StageResultWords } from "./stage-result-words.js";
import { promptTemplatesFor } from "../../prompt-templates/index.fixtures.js";
import { PIPELINES_PROMPT_TEMPLATES } from "../domain/pipelines-prompt-templates.js";

const promptTemplates = await promptTemplatesFor(PIPELINES_PROMPT_TEMPLATES);

const stages = [
  { key: "implement", kind: "agent", name: "Implement", role: "oscar" },
  { key: "review", kind: "agent", name: "Review", role: "rui" },
  { key: "gate", kind: "gate", name: "Gate" },
] as unknown as readonly Stage[];

function aRun(stageKey: string, summary: string, handoverNote: string): StageRun {
  const outcome = { status: "done", summary, handoverNote };
  return { stageKey, outcome, decisions: [] } as unknown as StageRun;
}

function wordsOf(runs: readonly StageRun[]): StageResultWords {
  return new StageResultWords(
    { list: () => Promise.resolve(runs) } as unknown as StageRunRepository,
    { find: () => Promise.resolve({ stages }) } as unknown as TaskStagesRepository,
    promptTemplates,
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

  it("gives every Handover note for the whole Task, with its Stage and Role", async () => {
    const words = wordsOf([
      aRun("implement", "Fixed it.", "Left: the logout page."),
      aRun("review", "Looks right.", "Left: nothing."),
      aRun("implement", "Fixed the review's finding.", "Left: none."),
    ]);

    await expect(words.ofTask("task")).resolves.toEqual({
      lines: [
        "- Implement (Agent Stage): done. Fixed it.",
        "- Review (Agent Stage): done. Looks right.",
        "- Implement (Agent Stage): done. Fixed the review's finding.",
      ],
      handoverNotes: [
        { stageName: "Implement", roleKey: "oscar", note: "Left: the logout page." },
        { stageName: "Review", roleKey: "rui", note: "Left: nothing." },
        { stageName: "Implement", roleKey: "oscar", note: "Left: none." },
      ],
    });
  });

  it("is empty before any Stage ran", async () => {
    await expect(wordsOf([]).ofTask("task")).resolves.toEqual({ lines: [], handoverNotes: [] });
    await expect(wordsOf([]).of("task", "oscar")).resolves.toEqual({
      lines: [],
      handoverNotes: [],
    });
  });
});

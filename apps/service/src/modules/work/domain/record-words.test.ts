import { describe, expect, it } from "vitest";
import { THE_USER } from "./author.js";
import { taskRecordText } from "./record-words.js";
import { aTask } from "./work.fixtures.js";

describe("taskRecordText", () => {
  it("names each Move to another Project, oldest first", () => {
    const task = aTask({
      projectId: "shop",
      projectMoves: [
        { from: "docs", to: "admin-panel", at: new Date("2026-11-01T10:00:00.000Z"), by: THE_USER },
        { from: "admin-panel", to: "shop", at: new Date("2026-11-02T10:00:00.000Z"), by: THE_USER },
      ],
    });

    const lines = taskRecordText(task, [], [], []).split("\n");

    expect(lines.filter((line) => line.startsWith("- Moved"))).toEqual([
      "- Moved from Project docs to Project admin-panel by the user on 2026-11-01T10:00:00.000Z",
      "- Moved from Project admin-panel to Project shop by the user on 2026-11-02T10:00:00.000Z",
    ]);
  });

  it("names no Move for a Task that never moved", () => {
    expect(taskRecordText(aTask(), [], [], [])).not.toContain("Moved from");
  });
});

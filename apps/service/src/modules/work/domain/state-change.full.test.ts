import { describe, expect, it } from "vitest";
import { stateChangeLines, type StateChange } from "./state-change.js";
import { ANN_LEE, BEN_ITO } from "./work.fixtures.js";

const CREATED: StateChange = {
  from: undefined,
  to: "backlog",
  at: new Date("2026-10-30T09:00:00.000Z"),
  by: { kind: "person", roleKey: "cto" },
};
const STARTED: StateChange = {
  from: "ready",
  to: "in-progress",
  at: new Date("2026-10-30T10:00:00.000Z"),
  by: { kind: "queue", queuedBy: BEN_ITO },
};
const HELD: StateChange = {
  from: "in-progress",
  to: "paused",
  at: new Date("2026-10-30T11:00:00.000Z"),
  by: { kind: "office", reason: "nobody can work its next Stages." },
};

const accepted = (by: StateChange["by"]): StateChange => ({
  from: "planning",
  to: "ready",
  at: new Date("2026-10-30T12:00:00.000Z"),
  by,
});

describe("a Task's state changes on its record", () => {
  it("names the user who made each change, and only says the user for one from before users", () => {
    expect(
      stateChangeLines([
        { ...STARTED, by: ANN_LEE },
        { ...HELD, by: BEN_ITO },
        { ...STARTED, by: { kind: "user", user: null } },
        { ...STARTED, by: { kind: "queue", queuedBy: null } },
      ]).slice(1),
    ).toEqual([
      "- 2026-10-30T10:00:00.000Z: Ready → In progress, by the user Ann Lee",
      "- 2026-10-30T11:00:00.000Z: In progress → Paused, by the user Ben Ito",
      "- 2026-10-30T10:00:00.000Z: Ready → In progress, by the user",
      "- 2026-10-30T10:00:00.000Z: Ready → In progress, by the queue, as its turn came",
    ]);
  });

  it("lists each from its creation, with who or what made it", () => {
    expect(stateChangeLines([CREATED, STARTED, HELD])).toEqual([
      "State changes:",
      "- 2026-10-30T09:00:00.000Z: created in Backlog, by the person in the Role cto",
      "- 2026-10-30T10:00:00.000Z: Ready → In progress, by the queue, as its turn came (queued by the user Ben Ito)",
      "- 2026-10-30T11:00:00.000Z: In progress → Paused, by The Office: nobody can work its next Stages.",
    ]);
  });

  it("names what auto mode confirmed as it marked the Task Ready, and only that", () => {
    expect(
      stateChangeLines([
        accepted({
          kind: "auto-mode",
          confirmed: [
            { part: "plan" },
            { part: "definition-of-done" },
            { part: "pipeline", pipelineId: "full" },
          ],
        }),
        accepted({ kind: "auto-mode", confirmed: [{ part: "definition-of-done" }] }),
        accepted({ kind: "auto-mode", confirmed: [] }),
      ]).slice(1),
    ).toEqual([
      "- 2026-10-30T12:00:00.000Z: Planning → Ready, by auto mode, which confirmed the Plan, the Definition of Done and the Pipeline full",
      "- 2026-10-30T12:00:00.000Z: Planning → Ready, by auto mode, which confirmed the Definition of Done",
      "- 2026-10-30T12:00:00.000Z: Planning → Ready, by auto mode",
    ]);
  });

  it("says the earlier ones weren't kept for a Task from before they were", () => {
    expect(stateChangeLines([{ ...STARTED, by: ANN_LEE }])).toEqual([
      "State changes since The Office began keeping them (earlier ones weren't kept):",
      "- 2026-10-30T10:00:00.000Z: Ready → In progress, by the user Ann Lee",
    ]);
    expect(stateChangeLines([])).toEqual([
      "State changes since The Office began keeping them (earlier ones weren't kept):",
      "None kept yet.",
    ]);
  });
});

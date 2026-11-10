import { describe, expect, it } from "vitest";
import { createTask } from "./task-changes.js";
import { TaskTagsChanged } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { changeTags, normalizedTags, tagsProblems } from "./task-tags.js";
import { THE_USER } from "./author.js";
import { aTask } from "./work.fixtures.js";

describe("normalizedTags", () => {
  it("keeps each Tag once, lower-case, spaces made hyphens, in the order given", () => {
    expect(normalizedTags([" BLE", "sync  protocol", "ble", "", "  "])).toEqual([
      "ble",
      "sync-protocol",
    ]);
  });
});

describe("tagsProblems", () => {
  it("names too many Tags and every Tag too long", () => {
    const many = Array.from({ length: 13 }, (_, at) => `tag-${at}`);

    expect(tagsProblems(many)).toEqual(["A Task can have at most 12 Tags."]);
    expect(tagsProblems(["x".repeat(32), "y".repeat(33)])).toEqual([
      `The Tag "${"y".repeat(33)}" is longer than 32 characters.`,
    ]);
  });
});

describe("changeTags", () => {
  it("sets the Tags in any state and announces them", () => {
    const done = aTask({ state: "done", tags: ["ui"] });

    const { task, event } = changeTags(done, ["UI", "Bug"]) ?? {};

    expect(task?.tags).toEqual(["ui", "bug"]);
    expect(event).toBeInstanceOf(TaskTagsChanged);
    expect(event).toMatchObject({ taskId: done.id, tags: ["ui", "bug"] });
  });

  it("changes nothing when the Tags already are those", () => {
    expect(changeTags(aTask({ tags: ["ui", "bug"] }), ["ui", " Bug"])).toBeUndefined();
  });

  it("refuses Tags it can't keep", () => {
    expect(() => changeTags(aTask(), ["x".repeat(33)])).toThrow(TaskRefused);
  });
});

describe("a new Task's Tags", () => {
  const setting = {
    pipelineId: "full",
    order: "a0",
    originIdeaId: undefined,
    initiativeId: undefined,
    createdBy: THE_USER,
  };

  it("are none when none are given, and normalized when they are", () => {
    const given = { title: "Pair a device", projectId: "firmware", priority: "normal" } as const;

    expect(createTask("t1", given, setting, new Date()).task.tags).toEqual([]);
    expect(createTask("t2", { ...given, tags: ["BLE"] }, setting, new Date()).task.tags).toEqual([
      "ble",
    ]);
  });

  it("are refused alongside the title, with every reason", () => {
    const given = {
      title: "",
      projectId: "firmware",
      priority: "normal",
      tags: ["y".repeat(33)],
    } as const;

    expect(() => createTask("t3", given, setting, new Date())).toThrow(
      expect.objectContaining({
        reasons: [expect.any(String), `The Tag "${"y".repeat(33)}" is longer than 32 characters.`],
      }),
    );
  });
});

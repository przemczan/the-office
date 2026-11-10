import { describe, expect, it } from "vitest";
import { changeDescription, changeTitle } from "./task-description.js";
import { TaskDescriptionChanged, TaskTitleChanged } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { NOT_STARTED_STATES, STARTED_STATES } from "./task-states.js";
import { aTask } from "./work.fixtures.js";

describe("changeDescription", () => {
  it.each(NOT_STARTED_STATES)("rewrites the Description, trimmed, in %s", (state) => {
    const change = changeDescription(aTask({ state }), "  Land where I came from. ");

    expect(change?.task.description).toBe("Land where I came from.");
    expect(change?.event).toBeInstanceOf(TaskDescriptionChanged);
    expect(change?.event).toMatchObject({ taskId: "task-1" });
  });

  it("empties the Description, leaving the title all there is", () => {
    const change = changeDescription(aTask({ description: "Land where I came from." }), "  ");

    expect(change?.task.description).toBe("");
  });

  it("changes nothing when the Description already reads so", () => {
    const task = aTask({ description: "Land where I came from." });

    expect(changeDescription(task, "Land where I came from. ")).toBeUndefined();
  });

  it.each([...STARTED_STATES, "done", "dropped"] as const)(
    "refuses once the Task has started: %s",
    (state) => {
      expect(() => changeDescription(aTask({ state }), "Something else.")).toThrow(
        new TaskRefused(["A Task keeps its Description once it has started."]),
      );
    },
  );
});

describe("changeTitle", () => {
  it.each(NOT_STARTED_STATES)("rewrites the title, trimmed, of a Task in %s", (state) => {
    const change = changeTitle(aTask({ state }), "  Land where I came from. ");

    expect(change?.task.title).toBe("Land where I came from.");
    expect(change?.event).toBeInstanceOf(TaskTitleChanged);
  });

  it("changes nothing when the title already reads so", () => {
    const task = aTask({ title: "Land where I came from." });

    expect(changeTitle(task, " Land where I came from. ")).toBeUndefined();
  });

  it.each([
    ["  ", "Give the Task a title."],
    ["Two\nlines", "A Task's title must be one line."],
    ["x".repeat(121), "A Task's title may be at most 120 characters."],
  ])("refuses the title %j", (title, reason) => {
    expect(() => changeTitle(aTask(), title)).toThrow(new TaskRefused([reason]));
  });

  it.each([...STARTED_STATES, "done", "dropped"] as const)(
    "refuses once the Task has started: %s",
    (state) => {
      expect(() => changeTitle(aTask({ state }), "Something else.")).toThrow(
        new TaskRefused(["A Task keeps its title once it has started."]),
      );
    },
  );
});

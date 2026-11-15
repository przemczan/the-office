import { describe, expect, it } from "vitest";
import {
  changeCommitMessage,
  commitMessageOf,
  defaultCommitMessage,
  publishCommitMessage,
} from "./task-commit-message.js";
import { TaskCommitMessageChanged } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { NOT_STARTED_STATES, STARTED_STATES } from "./task-states.js";
import { aTask } from "./work.fixtures.js";

const PUBLISHED_AT = new Date("2026-11-15T10:00:00.000Z");

describe("changeCommitMessage", () => {
  it.each([...NOT_STARTED_STATES, ...STARTED_STATES])(
    "rewrites the commit message, trimmed, in %s, leaving the state as it is",
    (state) => {
      const change = changeCommitMessage(aTask({ state }), "  feat: rename a device\n\nBody.\n ");

      expect(change?.task.commitMessage).toBe("feat: rename a device\n\nBody.");
      expect(change?.task.state).toBe(state);
      expect(change?.event).toBeInstanceOf(TaskCommitMessageChanged);
      expect(change?.event).toMatchObject({ taskId: "task-1" });
    },
  );

  it("clears it back to the default when empty", () => {
    const change = changeCommitMessage(aTask({ commitMessage: "feat: rename" }), "  ");

    expect(change?.task.commitMessage).toBe("");
  });

  it("changes nothing when it already reads so", () => {
    expect(changeCommitMessage(aTask({ commitMessage: "feat: rename" }), "feat: rename ")).toBe(
      undefined,
    );
  });

  it.each(["done", "dropped"] as const)("refuses once the Task is %s", (state) => {
    expect(() => changeCommitMessage(aTask({ state }), "feat: rename")).toThrow(
      new TaskRefused(["A Done or Dropped Task keeps its commit message."]),
    );
  });

  it("refuses once Publish landed it", () => {
    const task = aTask({ state: "in-progress", commitMessagePublishedAt: PUBLISHED_AT });

    expect(() => changeCommitMessage(task, "feat: rename")).toThrow(
      new TaskRefused(["Publish has landed the commit message, so it no longer changes."]),
    );
  });
});

describe("publishCommitMessage", () => {
  it("keeps when Publish landed it, once", () => {
    const change = publishCommitMessage(aTask(), PUBLISHED_AT);

    expect(change?.task.commitMessagePublishedAt).toEqual(PUBLISHED_AT);
    expect(change?.event).toBeInstanceOf(TaskCommitMessageChanged);
    expect(
      publishCommitMessage(aTask({ commitMessagePublishedAt: PUBLISHED_AT }), new Date()),
    ).toBeUndefined();
  });
});

describe("defaultCommitMessage", () => {
  it("is the title with the Description's first paragraph below it as a short summary", () => {
    expect(
      defaultCommitMessage({
        title: "Rename a device",
        description: "  Let me name each device.\nAs I call it.\n\nAnd more, later.",
      }),
    ).toBe("Rename a device\n\nLet me name each device.\nAs I call it.");
  });

  it("is the title alone with no Description", () => {
    expect(defaultCommitMessage({ title: "Rename a device", description: "" })).toBe(
      "Rename a device",
    );
  });
});

describe("commitMessageOf", () => {
  it("is the one written, or the default", () => {
    expect(commitMessageOf(aTask({ title: "Rename", commitMessage: "feat: rename" }))).toBe(
      "feat: rename",
    );
    expect(commitMessageOf(aTask({ title: "Rename", commitMessage: "" }))).toBe("Rename");
  });
});

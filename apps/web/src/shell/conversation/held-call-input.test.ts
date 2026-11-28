import { describe, expect, it } from "vitest";
import { inputEntries, inputLabel } from "./held-call-input.ts";

const TASK = { kind: "task", id: "t-1", title: "Fix the export" };

describe("inputLabel", () => {
  it("reads a key in words", () => {
    expect(inputLabel("taskId")).toBe("Task");
    expect(inputLabel("definitionOfDone")).toBe("Definition of done");
    expect(inputLabel("base_branch")).toBe("Base branch");
    expect(inputLabel("title")).toBe("Title");
  });

  it("keeps a key that is only an id", () => {
    expect(inputLabel("id")).toBe("Id");
  });
});

describe("inputEntries", () => {
  it("lists each value under its label and leaves out empty ones", () => {
    expect(
      inputEntries({ title: "New", note: "", due: null, count: 3, urgent: false }, null),
    ).toEqual([
      { label: "Title", value: { kind: "text", text: "New", long: false } },
      { label: "Count", value: { kind: "text", text: "3", long: false } },
      { label: "Urgent", value: { kind: "text", text: "false", long: false } },
    ]);
  });

  it("shows the id that is the subject's as its link", () => {
    expect(inputEntries({ taskId: "t-1", other: "t-1" }, TASK)).toEqual([
      { label: "Task", value: { kind: "subject", subject: TASK } },
      { label: "Other", value: { kind: "text", text: "t-1", long: false } },
    ]);
  });

  it("marks a long or multi-line text as a block", () => {
    const [multiline, long] = inputEntries({ a: "one\ntwo", b: "x".repeat(81) }, null);
    expect(multiline?.value).toMatchObject({ kind: "text", long: true });
    expect(long?.value).toMatchObject({ kind: "text", long: true });
  });

  it("shows lists and nested objects as nested lists", () => {
    expect(
      inputEntries({ commands: ["build", "test"], limits: { memoryMegabytes: 512 } }, null),
    ).toEqual([
      {
        label: "Commands",
        value: {
          kind: "list",
          entries: [
            { label: "1", value: { kind: "text", text: "build", long: false } },
            { label: "2", value: { kind: "text", text: "test", long: false } },
          ],
        },
      },
      {
        label: "Limits",
        value: {
          kind: "list",
          entries: [
            { label: "Memory megabytes", value: { kind: "text", text: "512", long: false } },
          ],
        },
      },
    ]);
  });

  it("leaves out a list or object with nothing in it", () => {
    expect(inputEntries({ commands: [], limits: { note: "" } }, null)).toEqual([]);
  });

  it("has no entries for an input that isn't an object", () => {
    expect(inputEntries("text", null)).toEqual([]);
    expect(inputEntries(undefined, null)).toEqual([]);
  });
});

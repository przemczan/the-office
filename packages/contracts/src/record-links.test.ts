import { describe, expect, it } from "vitest";
import { recordLinkOf, recordLinksIn, recordPath, type RecordLink } from "./record-links.js";

const TASK = "0f8e7c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const THREAD = "1a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d";
const DECISION = "2b3c4d5e-6f7a-4b2c-8d3e-4f5a6b7c8d9e";
const IDEA = "3c4d5e6f-7a8b-4c3d-9e4f-5a6b7c8d9e0f";

describe("record links", () => {
  it.each<RecordLink>([
    { kind: "task", taskId: TASK },
    { kind: "idea", ideaId: IDEA },
    { kind: "decision", taskId: TASK, threadId: THREAD, decisionId: DECISION },
    { kind: "decision", taskId: TASK, threadId: undefined, decisionId: DECISION },
  ])("reads back the $kind its path points to", (link) => {
    expect(recordLinkOf(recordPath(link))).toEqual(link);
  });

  it("reads a pasted URL from any host the web app is served on", () => {
    expect(recordLinkOf(`https://192.168.1.20:4310/tasks/${TASK}`)).toEqual({
      kind: "task",
      taskId: TASK,
    });
  });

  it("takes no other page, and no id that isn't one", () => {
    expect(recordLinkOf("/work/ideas")).toBeUndefined();
    expect(recordLinkOf("/tasks/not-an-id")).toBeUndefined();
    expect(recordLinkOf(`/tasks/${TASK}?decision=nope`)).toBeUndefined();
    expect(recordLinkOf(`/people/${TASK}`)).toBeUndefined();
    expect(recordLinkOf("https://example.com/docs")).toBeUndefined();
  });

  it("finds each record a message links to once, Markdown links and pasted URLs alike", () => {
    const text = [
      `Compare [@Export CSV](/tasks/${TASK}) with [@Decision on Export CSV](/tasks/${TASK}?taskThread=${THREAD}&decision=${DECISION}),`,
      `see /tasks/${TASK} again, and http://localhost:4310/work/ideas?idea=${IDEA}.`,
    ].join("\n");

    expect(recordLinksIn(text)).toEqual([
      { kind: "task", taskId: TASK },
      { kind: "decision", taskId: TASK, threadId: THREAD, decisionId: DECISION },
      { kind: "idea", ideaId: IDEA },
    ]);
  });
});

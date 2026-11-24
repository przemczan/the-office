import { describe, expect, it } from "vitest";
import { edgeHighlight } from "./task-graph-highlight.ts";

function edge(from: string, to: string, blockerDone = false) {
  return { from, to, blockerDone };
}

describe("edgeHighlight", () => {
  it("marks nothing while no Task is highlighted", () => {
    expect(edgeHighlight(edge("a", "b"), undefined)).toBeUndefined();
  });

  it("marks an arrow into the highlighted Task, green while its blocker is Done", () => {
    expect(edgeHighlight(edge("a", "b"), "b")).toBe("into");
    expect(edgeHighlight(edge("a", "b", true), "b")).toBe("into-done");
  });

  it("marks an arrow out of the highlighted Task, whether or not it is Done", () => {
    expect(edgeHighlight(edge("a", "b"), "a")).toBe("out");
    expect(edgeHighlight(edge("a", "b", true), "a")).toBe("out");
  });

  it("dims every edge that neither starts nor ends at the highlighted Task", () => {
    expect(edgeHighlight(edge("a", "b"), "c")).toBe("dimmed");
  });
});

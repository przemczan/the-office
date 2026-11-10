import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { OfficeTool } from "../ports/office-tool.js";
import { OfficeToolRegistry } from "./office-tool-registry.js";

function officeTool(name: string): OfficeTool {
  return {
    name,
    description: `The ${name} tool.`,
    input: z.object({}),
    run: () => Promise.resolve({ text: "Done.", isError: false }),
  };
}

describe("OfficeToolRegistry", () => {
  it("gives the tools of the names asked for, in their order", () => {
    const registry = new OfficeToolRegistry();
    const [note, decision, attach] = ["handover_note", "open_decision", "attach"].map(officeTool);
    for (const tool of [note, decision, attach]) registry.register(tool as OfficeTool);

    expect(registry.named(["attach", "handover_note"])).toEqual([attach, note]);
    expect(registry.named([])).toEqual([]);
  });

  it("refuses a name no module registered, naming it", () => {
    const registry = new OfficeToolRegistry();
    registry.register(officeTool("attach"));

    expect(() => registry.named(["attach", "consult", "open_decision"])).toThrow(
      "No Office tool is registered as consult, open_decision.",
    );
  });

  it("refuses a second tool of a name, and a name that isn't snake_case", () => {
    const registry = new OfficeToolRegistry();
    registry.register(officeTool("attach"));

    expect(() => registry.register(officeTool("attach"))).toThrow(
      "An Office tool named attach is registered already.",
    );
    expect(() => registry.register(officeTool("Open Decision"))).toThrow(
      '"Open Decision" is not an Office tool\'s name: write it in snake_case.',
    );
  });
});

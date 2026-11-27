import { describe, expect, it } from "vitest";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { developer, toolWith, input } from "./role-office-tools.fixtures.js";

describe("the change_role tool", () => {
  it("rewords the Role, as proposed by the caller, when the call may run", async () => {
    const { tool, reworded } = toolWith({ kind: "proceed", roleKey: "planner" });

    const result = await tool.run(input, anOfficeToolCall("session-1"));

    expect(result.isError).toBe(false);
    expect(reworded).toEqual([
      {
        key: "developer",
        card: { ...developer.role.card, instructions: "Write tests first." },
        skills: ["testing"],
        savedBy: null,
        proposedBy: "planner",
      },
    ]);
  });

  it("is refused with the words the Role card's save is refused with", async () => {
    const reasons = ["The title is empty.", "The engine is not offered."];
    const { tool } = toolWith({ kind: "proceed", roleKey: "planner" }, reasons);

    await expect(tool.run(input, anOfficeToolCall("session-1"))).resolves.toEqual({
      text: reasons.join(" "),
      isError: true,
    });
  });

  it("changes nothing and tells the Agent to end its turn while the call is held", async () => {
    const { tool, reworded, holds } = toolWith({ kind: "held", waitingOn: "the user" });

    const result = await tool.run(input, anOfficeToolCall("session-1"));

    expect(result).toMatchObject({ isError: false });
    expect(result.text).toContain("End your turn");
    expect(holds[0]?.call).toBe("Change the Developer's instructions to: Write tests first.");
    expect(reworded).toEqual([]);
  });
});

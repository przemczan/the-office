import { describe, expect, it } from "vitest";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { toolWith, input } from "./role-office-tools.fixtures.js";

describe("the change_role tool", () => {
  it("changes nothing and gives the reason when the call is refused", async () => {
    const { tool, reworded } = toolWith({ kind: "refused", reason: "Change Roles is Never." });

    await expect(tool.run(input, anOfficeToolCall("session-1"))).resolves.toEqual({
      text: "Change Roles is Never.",
      isError: true,
    });
    expect(reworded).toEqual([]);
  });

  it("asks nobody about a Role that isn't there", async () => {
    const { tool, holds } = toolWith({ kind: "proceed", roleKey: "planner" });

    await expect(
      tool.run({ ...input, role: "janitor" }, anOfficeToolCall("session-1")),
    ).resolves.toEqual({ text: 'The Office has no Role "janitor".', isError: true });
    expect(holds).toEqual([]);
  });

  it("asks what to change when the call changes nothing", async () => {
    const { tool, holds } = toolWith({ kind: "proceed", roleKey: "planner" });

    const result = await tool.run({ role: "developer", why: "Because." }, anOfficeToolCall("s"));

    expect(result.isError).toBe(true);
    expect(holds).toEqual([]);
  });
});

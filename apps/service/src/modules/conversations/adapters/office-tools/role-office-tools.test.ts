import { describe, expect, it } from "vitest";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { RoleNotFound, type RoleService } from "../../../people/index.js";
import type { HeldCallOutcome, HeldCalls } from "../../application/held-calls.js";
import { CHANGE_ROLE_TOOL } from "../../domain/session-instructions.js";
import { RoleOfficeTools } from "./role-office-tools.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";

type Words = Parameters<RoleService["reword"]>[1];

const developer = { role: { key: "developer", card: { name: "Ada", title: "Developer" } } };

/** The tool as registered, over a People that keeps the rewordings and a hold that rules as told. */
function toolWith(outcome: HeldCallOutcome) {
  const reworded: Array<{ key: string; words: Words; proposedBy: string }> = [];
  const holds: Array<{ call: string }> = [];
  const roles = {
    read: (key: string) => {
      if (key !== "developer") throw new RoleNotFound(key);
      return Promise.resolve(developer);
    },
    reword: (key: string, words: Words, proposedBy: string) => {
      reworded.push({ key, words, proposedBy });
      return Promise.resolve(developer);
    },
  } as unknown as RoleService;
  const heldCalls = {
    hold: (request: { call: string }) => {
      holds.push(request);
      return Promise.resolve(outcome);
    },
  } as unknown as HeldCalls;
  const registry = new OfficeToolRegistry();
  new RoleOfficeTools(registry, roles, heldCalls).onModuleInit();
  const [tool] = registry.named([CHANGE_ROLE_TOOL]);
  if (!tool) throw new Error("change_role is not registered.");
  return { tool, reworded, holds };
}

const input = { role: "developer", instructions: "Write tests first.", why: "Fewer regressions." };

describe("the change_role tool", () => {
  it("rewords the Role, as proposed by the caller, when the call may run", async () => {
    const { tool, reworded } = toolWith({ kind: "proceed", roleKey: "planner" });

    const result = await tool.run(input, anOfficeToolCall("session-1"));

    expect(result.isError).toBe(false);
    expect(reworded).toEqual([
      { key: "developer", words: { instructions: "Write tests first." }, proposedBy: "planner" },
    ]);
  });

  it("changes nothing and tells the Agent to end its turn while the call is held", async () => {
    const { tool, reworded, holds } = toolWith({ kind: "held", waitingOn: "the user" });

    const result = await tool.run(input, anOfficeToolCall("session-1"));

    expect(result).toMatchObject({ isError: false });
    expect(result.text).toContain("End your turn");
    expect(holds[0]?.call).toBe("Change the Developer's instructions to: Write tests first.");
    expect(reworded).toEqual([]);
  });

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

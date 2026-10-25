import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";
import { linux } from "../../../../platform/os/linux.js";
import { OfficeRules } from "../../domain/office-rules.js";
import { officeRulesHook } from "./office-rules-hook.js";
import { ToolRefusals } from "./tool-refusals.js";

const SYSTEM = linux({ variables: {}, homeDirectory: "/home/office" });

function rules(paths = SYSTEM.paths): OfficeRules {
  return new OfficeRules({
    workingFolder: "/work/task-1",
    readableFolders: [],
    profile: { edit: false, run: { kind: "anything" }, web: false },
    userSecrets: SYSTEM.secretPaths,
    officeFiles: [],
    homeFolder: "/home/office",
    environment: {},
    paths,
  });
}

const preToolUse = (tool_name: string, tool_input: unknown): HookInput =>
  ({
    hook_event_name: "PreToolUse",
    tool_name,
    tool_input,
    tool_use_id: "c1",
    session_id: "s",
    transcript_path: "",
    cwd: "/work/task-1",
  }) as HookInput;

const SIGNAL = { signal: new AbortController().signal };

describe("officeRulesHook", () => {
  it("allows what the Office rules allow, so nothing waits on a prompt", async () => {
    const hook = officeRulesHook(rules(), new ToolRefusals());

    await expect(
      hook(preToolUse("Read", { file_path: "README.md" }), "c1", SIGNAL),
    ).resolves.toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
    });
  });

  it("refuses with the reason the Agent reads, and keeps the refusal for the Thread log", async () => {
    const refusals = new ToolRefusals();
    const refused = vi.spyOn(refusals, "refusedByOfficeRules");
    const hook = officeRulesHook(rules(), refusals);

    await expect(
      hook(preToolUse("Write", { file_path: "a.ts", content: "" }), "c1", SIGNAL),
    ).resolves.toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Not allowed in this session: editing files.",
      },
    });
    expect(refused).toHaveBeenCalledWith("c1", "Not allowed in this session: editing files.");
  });

  it("refuses a call it fails to judge rather than let it through", async () => {
    const broken = rules({
      ...SYSTEM.paths,
      resolve: () => {
        throw new Error("no such drive");
      },
    });
    const hook = officeRulesHook(broken, new ToolRefusals());

    await expect(
      hook(preToolUse("Read", { file_path: "README.md" }), "c1", SIGNAL),
    ).resolves.toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "Refused by The Office: it could not judge this call (no such drive).",
      },
    });
  });
});

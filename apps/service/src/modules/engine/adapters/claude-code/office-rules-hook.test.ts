import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";
import { linux } from "../../../../platform/os/linux.js";
import { OfficeRules } from "../../domain/office-rules.js";
import type { PermissionProfile } from "../../domain/permission-profile.js";
import type { ApprovalHold } from "../../ports/session-options.js";
import { officeRulesHook } from "./office-rules-hook.js";
import { OFFICE_TOOL_PREFIX } from "../office-rules/office-tool-names.js";
import { ToolRefusals } from "./tool-refusals.js";

const SYSTEM = linux({ variables: {}, homeDirectory: "/home/office" });

function rules(paths = SYSTEM.paths, mcpTools: PermissionProfile["mcpTools"] = {}): OfficeRules {
  return new OfficeRules({
    workingFolder: "/work/task-1",
    readableFolders: [],
    profile: { edit: false, run: { kind: "anything" }, web: false, mcpTools },
    workstation: false,
    secrets: SYSTEM.secretPaths,
    officeFiles: [],
    cloneFolders: [],
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

const readOnly = (): OfficeRules =>
  new OfficeRules({
    workingFolder: "/work/task-1",
    readableFolders: [],
    profile: { edit: false, run: { kind: "read-only-git" }, web: false, mcpTools: {} },
    workstation: false,
    secrets: SYSTEM.secretPaths,
    officeFiles: [],
    cloneFolders: [],
    homeFolder: "/home/office",
    environment: {},
    paths: SYSTEM.paths,
  });

const lspCall = (filePath: string): HookInput =>
  preToolUse("LSP", { operation: "hover", filePath, line: 1, character: 1 });

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

  it.each([
    ["a Stage session", rules],
    ["a chat", readOnly],
  ])(
    "refuses the container runtime in %s, and keeps the refusal for the Thread log",
    async (_, sessionRules) => {
      const refusals = new ToolRefusals();
      const refused = vi.spyOn(refusals, "refusedByOfficeRules");
      const hook = officeRulesHook(sessionRules(), refusals);
      const reason = expect.stringMatching(
        /^Refused by The Office: Agents never reach the container runtime \(docker\)/,
      );

      await expect(
        hook(preToolUse("Bash", { command: "docker compose up -d" }), "c1", SIGNAL),
      ).resolves.toEqual({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      });
      expect(refused).toHaveBeenCalledWith("c1", reason);
    },
  );

  describe("an LSP call", () => {
    it("runs in a read-only session on a file in its folder", async () => {
      const hook = officeRulesHook(readOnly(), new ToolRefusals());

      await expect(hook(lspCall("/work/task-1/src/a.ts"), "c1", SIGNAL)).resolves.toEqual({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
      });
    });

    it("is refused outside the session's read area, and the refusal kept for the Thread log", async () => {
      const refusals = new ToolRefusals();
      const refused = vi.spyOn(refusals, "refusedByOfficeRules");
      const hook = officeRulesHook(readOnly(), refusals);

      await expect(hook(lspCall("/work/task-2/src/a.ts"), "c1", SIGNAL)).resolves.toMatchObject({
        hookSpecificOutput: { permissionDecision: "deny" },
      });
      expect(refused).toHaveBeenCalledOnce();
    });
  });

  it("judges each MCP tool by its setting, a call on approval by the session's approval hold", async () => {
    const approvalHold = vi.fn<ApprovalHold>(() => Promise.resolve("It waits on Devops."));
    const hook = officeRulesHook(
      rules(SYSTEM.paths, {
        "github/list_issues": { kind: "allowed" },
        "github/create_issue": { kind: "consult", role: "devops" },
        "github/delete_repository": { kind: "never" },
      }),
      new ToolRefusals(),
      { approvalHold },
    );
    const decisionOf = async (tool: string) => {
      const output = await hook(preToolUse(`mcp__github__${tool}`, {}), "c1", SIGNAL);
      return "hookSpecificOutput" in output ? output.hookSpecificOutput : undefined;
    };

    expect(await decisionOf("list_issues")).toMatchObject({ permissionDecision: "allow" });
    expect(await decisionOf("create_issue")).toMatchObject({
      permissionDecision: "deny",
      permissionDecisionReason: "It waits on Devops.",
    });
    expect(approvalHold).toHaveBeenCalledWith({
      server: "github",
      tool: "create_issue",
      input: {},
      setting: { kind: "consult", role: "devops" },
    });
    expect(await decisionOf("delete_repository")).toMatchObject({
      permissionDecision: "deny",
      permissionDecisionReason:
        "Not allowed in this session: the github/delete_repository MCP tool.",
    });
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

  describe("while The Office holds every tool call", () => {
    const ALARM =
      "Refused by The Office: the fire alarm is on, so no Agent runs tools until the all clear.";

    it("refuses each call in the hold's words, an Office tool's too, and keeps it for the Thread log", async () => {
      const refusals = new ToolRefusals();
      const refused = vi.spyOn(refusals, "refusedByOfficeRules");
      const hook = officeRulesHook(rules(), refusals, {
        toolHold: () => Promise.resolve(ALARM),
      });
      const denied = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: ALARM,
        },
      };

      await expect(
        hook(preToolUse("Read", { file_path: "README.md" }), "c1", SIGNAL),
      ).resolves.toEqual(denied);
      await expect(
        hook(preToolUse(`${OFFICE_TOOL_PREFIX}read_task`, {}), "c1", SIGNAL),
      ).resolves.toEqual(denied);
      expect(refused).toHaveBeenCalledWith("c1", ALARM);
    });

    it("judges each call by the Office rules once the hold lets go, as for a lifted Thread", async () => {
      let held: string | undefined = ALARM;
      const hook = officeRulesHook(rules(), new ToolRefusals(), {
        toolHold: () => Promise.resolve(held),
      });
      await hook(preToolUse("Read", { file_path: "README.md" }), "c1", SIGNAL);

      held = undefined;

      await expect(
        hook(preToolUse("Read", { file_path: "README.md" }), "c2", SIGNAL),
      ).resolves.toEqual({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
      });
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import { linux } from "../../../../platform/os/linux.js";
import { OfficeRules } from "../../domain/office-rules.js";
import type { ApprovalHold } from "../../ports/session-options.js";
import { toolDecision } from "./tool-decision.js";

const SYSTEM = linux({ variables: {}, homeDirectory: "/home/office" });

const RULES = new OfficeRules({
  workingFolder: "/work/task-1",
  readableFolders: [],
  profile: {
    edit: false,
    run: { kind: "read-only-git" },
    web: false,
    mcpTools: {
      "github/list_issues": { kind: "allowed" },
      "github/create_issue": { kind: "consult", role: "devops" },
      "github/merge": { kind: "ask-me" },
      "github/delete_repo": { kind: "never" },
    },
  },
  userSecrets: SYSTEM.secretPaths,
  officeFiles: [],
  cloneFolders: [],
  homeFolder: "/home/office",
  environment: {},
  paths: SYSTEM.paths,
});

const INPUT = { title: "Bug" };

describe("toolDecision on an MCP tool", () => {
  it("runs an Allowed tool without asking anyone", async () => {
    const approvalHold = vi.fn<ApprovalHold>();

    await expect(
      toolDecision(RULES, { approvalHold }, "mcp__github__list_issues", INPUT),
    ).resolves.toEqual({ allowed: true });
    expect(approvalHold).not.toHaveBeenCalled();
  });

  it("refuses a tool set to Never in the rules' words, without asking anyone", async () => {
    const approvalHold = vi.fn<ApprovalHold>();

    await expect(
      toolDecision(RULES, { approvalHold }, "mcp__github__delete_repo", INPUT),
    ).resolves.toEqual({
      allowed: false,
      reason: "Not allowed in this session: the github/delete_repo MCP tool.",
    });
    expect(approvalHold).not.toHaveBeenCalled();
  });

  it.each([
    ["create_issue", { kind: "consult", role: "devops" }],
    ["merge", { kind: "ask-me" }],
  ] as const)(
    "holds %s through the approval hold, with its input and setting",
    async (tool, setting) => {
      const approvalHold = vi.fn<ApprovalHold>(() =>
        Promise.resolve("The call waits on the user."),
      );

      await expect(
        toolDecision(RULES, { approvalHold }, `mcp__github__${tool}`, INPUT),
      ).resolves.toEqual({ allowed: false, reason: "The call waits on the user." });
      expect(approvalHold).toHaveBeenCalledWith({ server: "github", tool, input: INPUT, setting });
    },
  );

  it("runs a held tool's call once the approval hold lets it", async () => {
    await expect(
      toolDecision(
        RULES,
        { approvalHold: () => Promise.resolve(undefined) },
        "mcp__github__merge",
        INPUT,
      ),
    ).resolves.toEqual({ allowed: true });
  });

  it("refuses a call waiting on approval in a session with no approval hold", async () => {
    await expect(toolDecision(RULES, {}, "mcp__github__merge", INPUT)).resolves.toMatchObject({
      allowed: false,
      reason: "The github/merge MCP tool runs only on approval, which this session can't ask for.",
    });
  });

  it("refuses a tool of a server the session wasn't given, such as a Project's own", async () => {
    await expect(toolDecision(RULES, {}, "mcp__project-db__query", INPUT)).resolves.toEqual({
      allowed: false,
      reason: "Not available in The Office: the project-db/query MCP tool.",
    });
  });

  it("refuses in the hold's words while The Office holds every call, before any approval", async () => {
    const approvalHold = vi.fn<ApprovalHold>();

    await expect(
      toolDecision(
        RULES,
        { toolHold: () => Promise.resolve("The fire alarm is on."), approvalHold },
        "mcp__github__merge",
        INPUT,
      ),
    ).resolves.toEqual({ allowed: false, reason: "The fire alarm is on." });
    expect(approvalHold).not.toHaveBeenCalled();
  });
});

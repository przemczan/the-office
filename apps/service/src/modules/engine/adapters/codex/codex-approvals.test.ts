import { describe, expect, it, vi } from "vitest";
import { linux } from "../../../../platform/os/linux.js";
import { windows } from "../../../../platform/os/windows.js";
import { OfficeRules } from "../../domain/office-rules.js";
import type { PermissionProfile } from "../../domain/permission-profile.js";
import type { ToolDecider } from "../office-rules/office-tool-call.js";
import type { SessionHolds } from "../office-rules/tool-decision.js";
import { toolDecision } from "../office-rules/tool-decision.js";
import {
  CodexApprovals,
  codexShellTool,
  GRANT_ROOT_REFUSAL,
  OUTSIDE_SANDBOX_REFUSAL,
  UNSEEN_COMMAND_REFUSAL,
  unwrappedCommand,
} from "./codex-approvals.js";
import type { CodexServerRequest, CodexThreadItem } from "./codex-protocol.js";

const SYSTEM = linux({ variables: {}, homeDirectory: "/home/office" });
const FOLDER = "/work/task-1";

const PROFILE: PermissionProfile = {
  edit: true,
  run: { kind: "anything" },
  web: false,
  mcpTools: {
    "github/list_issues": { kind: "allowed" },
    "github/delete_repo": { kind: "never" },
  },
};

function rules(profile: PermissionProfile = PROFILE): OfficeRules {
  return new OfficeRules({
    workingFolder: FOLDER,
    readableFolders: [],
    profile,
    workstation: false,
    secrets: SYSTEM.secretPaths,
    readableInSecrets: [],
    readsEngineTranscripts: false,
    officeFiles: ["/data/office"],
    cloneFolders: [],
    homeFolder: "/home/office",
    environment: { CODEX_HOME: "/data/office/engines/codex" },
    paths: SYSTEM.paths,
  });
}

/** Approvals judged by the real rules, keeping every call they were asked to judge. */
function approvals({
  profile,
  holds = {},
  outsideSandbox = false,
}: { profile?: PermissionProfile; holds?: SessionHolds; outsideSandbox?: boolean } = {}) {
  const sessionRules = rules(profile);
  const decide = vi.fn<ToolDecider>((tool, input) =>
    toolDecision(sessionRules, holds, tool, input),
  );
  const answering = new CodexApprovals({
    decide,
    folder: FOLDER,
    paths: SYSTEM.paths,
    defaultShell: "Bash",
    outsideSandbox,
  });
  return { answering, decide };
}

function commandRequest(
  command: string,
  more: Partial<
    Extract<CodexServerRequest, { method: "item/commandExecution/requestApproval" }>["params"]
  > = {},
): CodexServerRequest {
  return {
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "t",
      turnId: "u",
      itemId: "cmd-1",
      kind: "command",
      command,
      cwd: FOLDER,
      ...more,
    },
  };
}

function fileChangeRequest(itemId: string, grantRoot?: string): CodexServerRequest {
  return {
    method: "item/fileChange/requestApproval",
    params: { threadId: "t", turnId: "u", itemId, grantRoot: grantRoot ?? null },
  };
}

function fileChange(
  id: string,
  changes: Extract<CodexThreadItem, { type: "fileChange" }>["changes"],
) {
  return { type: "fileChange", id, status: "inProgress", changes } as const;
}

function elicitation(serverName: string, meta: unknown): CodexServerRequest {
  return {
    method: "mcpServer/elicitation/request",
    params: {
      threadId: "t",
      turnId: "u",
      serverName,
      mode: "form",
      message: "Allow the tool call?",
      _meta: meta,
    },
  };
}

function toolCallMeta(tool: string, params: unknown) {
  return { codex_approval_kind: "mcp_tool_call", tool_name: tool, tool_params: params };
}

describe("CodexApprovals on a command", () => {
  it("accepts a command the rules allow, judged as the line inside Codex's shell wrapper", async () => {
    const { answering, decide } = approvals();

    await expect(answering.answer(commandRequest("/bin/bash -lc 'ls -la src'"))).resolves.toEqual({
      result: { decision: "accept" },
    });
    expect(decide).toHaveBeenCalledWith("Bash", { command: "ls -la src" });
  });

  it("puts a 'known safe' read of a secret to the rules, which decline it", async () => {
    const { answering, decide } = approvals();

    const answer = await answering.answer(commandRequest("/bin/bash -lc 'cat ~/.ssh/id_rsa'"));

    expect(decide).toHaveBeenCalledWith("Bash", { command: "cat ~/.ssh/id_rsa" });
    expect(answer).toEqual({
      result: { decision: "decline" },
      refusal: {
        callId: "cmd-1",
        tool: "Bash",
        input: { command: "cat ~/.ssh/id_rsa" },
        reason: expect.stringMatching(/\/home\/office\/\.ssh holds the user's secrets/),
      },
    });
  });

  it("declines a request that doesn't say what it runs, without putting it to the rules", async () => {
    const { answering, decide } = approvals();

    for (const command of [null, "", "  "]) {
      const answer = await answering.answer(
        commandRequest("", { command, cwd: "/work/task-1/docs" }),
      );

      expect(answer.result).toEqual({ decision: "decline" });
      expect(answer.refusal?.reason).toBe(UNSEEN_COMMAND_REFUSAL);
    }
    expect(decide).not.toHaveBeenCalled();
  });

  it("runs read-only git under a profile that allows nothing else, as the wrapper isn't judged", async () => {
    const { answering } = approvals({ profile: { ...PROFILE, run: { kind: "read-only-git" } } });

    await expect(answering.answer(commandRequest("/bin/bash -lc 'git status'"))).resolves.toEqual({
      result: { decision: "accept" },
    });
  });

  it("judges a line that is more than the wrapper as a whole", async () => {
    const { answering, decide } = approvals({
      profile: { ...PROFILE, run: { kind: "read-only-git" } },
    });

    const answer = await answering.answer(commandRequest("/bin/bash -lc 'git status'; rm -rf src"));

    expect(decide).toHaveBeenCalledWith("Bash", {
      command: "/bin/bash -lc 'git status'; rm -rf src",
    });
    expect(answer.result).toEqual({ decision: "decline" });
  });

  it("moves to the folder a command runs in before judging it", async () => {
    const { answering, decide } = approvals();

    await answering.answer(
      commandRequest("/bin/bash -lc 'rm notes.txt'", { cwd: "/work/task-1/docs" }),
    );

    expect(decide).toHaveBeenCalledWith("Bash", {
      command: "cd '/work/task-1/docs' && rm notes.txt",
    });
  });

  it("declines a command asking to run outside the sandbox, whatever the rules say", async () => {
    const { answering, decide } = approvals();

    const answer = await answering.answer(
      commandRequest("/bin/bash -lc 'npm install'", { reason: "Needs the network to install" }),
    );

    expect(answer).toEqual({
      result: { decision: "decline" },
      refusal: {
        callId: "cmd-1",
        tool: "Bash",
        input: { command: "npm install" },
        reason: OUTSIDE_SANDBOX_REFUSAL,
      },
    });
    expect(decide).not.toHaveBeenCalled();
  });

  it("puts a request for the network or more permissions to the same refusal", async () => {
    const { answering } = approvals();

    const network = await answering.answer(
      commandRequest("/bin/bash -lc 'curl https://example.com'", {
        networkApprovalContext: { host: "example.com", protocol: "https" },
      }),
    );
    const permissions = await answering.answer(
      commandRequest("/bin/bash -lc 'touch /etc/x'", {
        additionalPermissions: { fileSystem: { write: ["/etc"] } },
      }),
    );

    expect(network.refusal?.reason).toBe(OUTSIDE_SANDBOX_REFUSAL);
    expect(permissions.refusal?.reason).toBe(OUTSIDE_SANDBOX_REFUSAL);
  });

  it("judges a request outside the sandbox by the rules in a session allowed outside it", async () => {
    const { answering } = approvals({ outsideSandbox: true });

    await expect(
      answering.answer(commandRequest("/bin/bash -lc 'npm install'", { reason: "network" })),
    ).resolves.toEqual({ result: { decision: "accept" } });
  });

  it("declines every command in the hold's words while The Office holds every call", async () => {
    const { answering } = approvals({
      holds: { toolHold: () => Promise.resolve("The fire alarm is on: no tool calls.") },
    });

    const answer = await answering.answer(commandRequest("/bin/bash -lc 'ls'"));

    expect(answer).toMatchObject({
      result: { decision: "decline" },
      refusal: { reason: "The fire alarm is on: no tool calls." },
    });
  });
});

describe("CodexApprovals on a file change", () => {
  it("accepts a change whose every path the rules allow, judging each as Write or Edit", async () => {
    const { answering, decide } = approvals();
    answering.itemStarted(
      fileChange("patch-1", [
        { path: `${FOLDER}/new.ts`, kind: { type: "add" }, diff: "+a" },
        {
          path: `${FOLDER}/old.ts`,
          kind: { type: "update", move_path: `${FOLDER}/moved.ts` },
          diff: "",
        },
        { path: `${FOLDER}/gone.ts`, kind: { type: "delete" }, diff: "" },
      ]),
    );

    await expect(answering.answer(fileChangeRequest("patch-1"))).resolves.toEqual({
      result: { decision: "accept" },
    });
    expect(decide.mock.calls).toEqual([
      ["Write", { file_path: `${FOLDER}/new.ts` }],
      ["Edit", { file_path: `${FOLDER}/old.ts` }],
      ["Write", { file_path: `${FOLDER}/moved.ts` }],
      ["Edit", { file_path: `${FOLDER}/gone.ts` }],
    ]);
  });

  it("declines a change one of whose paths the rules refuse, naming that one", async () => {
    const { answering } = approvals();
    answering.itemStarted(
      fileChange("patch-2", [
        { path: `${FOLDER}/fine.ts`, kind: { type: "add" }, diff: "+a" },
        { path: `${FOLDER}/a.ts`, kind: { type: "update", move_path: "/etc/a.ts" }, diff: "" },
      ]),
    );

    const answer = await answering.answer(fileChangeRequest("patch-2"));

    expect(answer).toEqual({
      result: { decision: "decline" },
      refusal: {
        callId: "patch-2",
        tool: "Write",
        input: { file_path: "/etc/a.ts" },
        reason: expect.stringContaining("/etc/a.ts is outside the worktree"),
      },
    });
  });

  it("declines a change that asks to write anywhere under a folder", async () => {
    const { answering, decide } = approvals();
    answering.itemStarted(
      fileChange("patch-3", [{ path: `${FOLDER}/a.ts`, kind: { type: "add" }, diff: "+a" }]),
    );

    const answer = await answering.answer(fileChangeRequest("patch-3", FOLDER));

    expect(answer).toMatchObject({
      result: { decision: "decline" },
      refusal: { reason: GRANT_ROOT_REFUSAL },
    });
    expect(decide).not.toHaveBeenCalled();
  });

  it("declines a change whose item it never saw, or saw complete", async () => {
    const { answering } = approvals();
    const item = fileChange("patch-4", [
      { path: `${FOLDER}/a.ts`, kind: { type: "add" }, diff: "" },
    ]);
    answering.itemStarted(item);
    answering.itemCompleted(item);

    const unseen = await answering.answer(fileChangeRequest("patch-5"));
    const completed = await answering.answer(fileChangeRequest("patch-4"));

    expect(unseen).toMatchObject({
      result: { decision: "decline" },
      refusal: { callId: "patch-5" },
    });
    expect(completed.result).toEqual({ decision: "decline" });
  });
});

describe("CodexApprovals on an MCP tool call", () => {
  it("accepts an Office tool's call, judged as mcp__office__<tool>", async () => {
    const { answering, decide } = approvals();

    await expect(
      answering.answer(elicitation("office", toolCallMeta("handover_note", { note: "Done" }))),
    ).resolves.toEqual({ result: { action: "accept", content: null, _meta: null } });
    expect(decide).toHaveBeenCalledWith("mcp__office__handover_note", { note: "Done" });
  });

  it("accepts the Skill tool of the office server", async () => {
    const { answering } = approvals();

    await expect(
      answering.answer(elicitation("office", toolCallMeta("Skill", { skill: "office:review" }))),
    ).resolves.toEqual({ result: { action: "accept", content: null, _meta: null } });
  });

  it("judges a server's tool by its setting: Allowed runs", async () => {
    const { answering, decide } = approvals();

    await expect(
      answering.answer(elicitation("github", toolCallMeta("list_issues", { state: "open" }))),
    ).resolves.toEqual({ result: { action: "accept", content: null, _meta: null } });
    expect(decide).toHaveBeenCalledWith("mcp__github__list_issues", { state: "open" });
  });

  it("declines a Never tool, naming the call that started for it", async () => {
    const { answering } = approvals();
    answering.itemStarted({
      type: "mcpToolCall",
      id: "mcp-1",
      server: "github",
      tool: "delete_repo",
      status: "inProgress",
      arguments: { repo: "x" },
    });

    const answer = await answering.answer(
      elicitation("github", toolCallMeta("delete_repo", { repo: "x" })),
    );

    expect(answer).toEqual({
      result: { action: "decline", content: null, _meta: null },
      refusal: {
        callId: "mcp-1",
        tool: "mcp__github__delete_repo",
        input: { repo: "x" },
        reason: "Not allowed in this session: the github/delete_repo MCP tool.",
      },
    });
  });

  it("declines an Office tool's call in the hold's words while every call is held", async () => {
    const { answering } = approvals({
      holds: { toolHold: () => Promise.resolve("The fire alarm is on.") },
    });

    const answer = await answering.answer(
      elicitation("office", toolCallMeta("handover_note", { note: "Done" })),
    );

    expect(answer).toMatchObject({
      result: { action: "decline" },
      refusal: { callId: undefined, tool: "handover_note", reason: "The fire alarm is on." },
    });
  });

  it("declines an elicitation that is no tool call's approval, refusing no call", async () => {
    const { answering, decide } = approvals();

    await expect(
      answering.answer(elicitation("github", { codex_approval_kind: "something_else" })),
    ).resolves.toEqual({ result: { action: "decline", content: null, _meta: null } });
    expect(decide).not.toHaveBeenCalled();
  });
});

describe("CodexApprovals on a permissions request", () => {
  it("grants nothing", async () => {
    const { answering } = approvals();

    const answer = await answering.answer({
      method: "item/permissions/requestApproval",
      params: {
        threadId: "t",
        turnId: "u",
        itemId: "perm-1",
        reason: "wants the network",
        permissions: { network: { enabled: true } },
      },
    });

    expect(answer).toMatchObject({
      result: { permissions: {}, scope: "turn" },
      refusal: { callId: "perm-1", reason: OUTSIDE_SANDBOX_REFUSAL },
    });
  });
});

describe("unwrappedCommand", () => {
  it("reads the script of a POSIX shell's -c or -lc", () => {
    expect(unwrappedCommand("/bin/bash -lc 'echo \"hi\" > out.txt'", "Bash")).toEqual({
      tool: "Bash",
      script: 'echo "hi" > out.txt',
    });
    expect(unwrappedCommand("sh -c 'ls'", "PowerShell")).toEqual({ tool: "Bash", script: "ls" });
  });

  it("reads the script of PowerShell's -Command", () => {
    expect(
      unwrappedCommand(
        '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoProfile -Command "Get-ChildItem src"',
        "Bash",
      ),
    ).toEqual({ tool: "PowerShell", script: "Get-ChildItem src" });
  });

  it("leaves any other line whole, in the system's shell", () => {
    expect(unwrappedCommand("ls -la", "PowerShell")).toEqual({
      tool: "PowerShell",
      script: "ls -la",
    });
    expect(unwrappedCommand("bash -lc 'ls' > out.txt", "Bash")).toEqual({
      tool: "Bash",
      script: "bash -lc 'ls' > out.txt",
    });
    expect(unwrappedCommand("bash script.sh", "Bash")).toEqual({
      tool: "Bash",
      script: "bash script.sh",
    });
  });
});

describe("codexShellTool", () => {
  it("judges Codex's commands as PowerShell where Agents have it, else as Bash", () => {
    expect(codexShellTool(SYSTEM.agentShells)).toBe("Bash");
    expect(
      codexShellTool(windows({ variables: {}, homeDirectory: "C:\\Users\\office" }).agentShells),
    ).toBe("PowerShell");
  });
});

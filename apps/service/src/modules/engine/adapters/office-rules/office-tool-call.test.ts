import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { FIRST_CLAUDE_CODE_ENGINE } from "../../domain/engines.js";
import type { PermissionProfile } from "../../domain/permission-profile.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { officeToolCall, sessionTemporaryFolder } from "./office-tool-call.js";
import { sessionOfficeRules } from "./session-office-rules.js";
import { toolDecision, type SessionHolds } from "./tool-decision.js";

const SESSION_ID = "5d1c7e0a-8b2f-4c3d-9e4f-0a1b2c3d4e5f";
const operatingSystem = currentOperatingSystem();
const { paths } = operatingSystem;

const ANYTHING: PermissionProfile = {
  edit: true,
  run: { kind: "anything" },
  web: false,
  mcpTools: {},
};
const READ_ONLY_GIT: PermissionProfile = { ...ANYTHING, run: { kind: "read-only-git" } };

let officeData: OfficeDataDirectory;
let worktree: string;

beforeEach(async () => {
  officeData = new OfficeDataDirectory(await mkdtemp(join(tmpdir(), "office-tool-call-")));
  worktree = join(officeData.path, "worktrees", "task-1");
});

afterEach(async () => {
  await rm(officeData.path, { recursive: true, force: true });
});

/** A session's Office tool call and its own tool decisions, from the same rules and holds. */
function session(profile: PermissionProfile, holds: SessionHolds = {}) {
  const options: SessionOptions = {
    deferredOfficeTools: [],
    folder: worktree,
    environment: {},
    engine: FIRST_CLAUDE_CODE_ENGINE,
    model: "claude-haiku-5-5",
    effort: "low",
    skills: undefined,
    profile,
    officeTools: [],
    mcpServers: [],
    languageServers: [],
    instructions: "",
    outputSchema: undefined,
  };
  const rules = sessionOfficeRules(operatingSystem, officeData, SESSION_ID, options, {
    readableFolders: [],
    environment: {},
  });
  const decide = (tool: string, input: unknown) => toolDecision(rules, holds, tool, input);
  return { call: officeToolCall(SESSION_ID, paths, decide), decide };
}

describe("an Office tool's call", () => {
  it.each([
    ["anything", ANYTHING, "npm test -- src/one.test.ts"],
    ["anything", ANYTHING, "git push origin HEAD"],
    ["anything", ANYTHING, "docker compose run --rm app npm test"],
    ["anything", ANYTHING, "env podman ps"],
    ["anything", ANYTHING, "cat ~/.ssh/id_rsa"],
    ["read-only git", READ_ONLY_GIT, "npm test"],
    ["read-only git", READ_ONLY_GIT, "git log --oneline"],
  ])(
    "judges a command line under the %s profile as the session's Bash call: %s",
    async (_profile, profile, commandLine) => {
      const { call, decide } = session(profile);

      const judged = await call.judgeCommand(commandLine);

      const asBash = await decide("Bash", { command: commandLine });
      expect(judged).toEqual(
        asBash.allowed ? { allowed: true } : { allowed: false, reason: asBash.reason },
      );
    },
  );

  it("refuses a command line while The Office holds the session's calls", async () => {
    const { call } = session(ANYTHING, {
      toolHold: () => Promise.resolve("The fire alarm is on."),
    });

    await expect(call.judgeCommand("npm test")).resolves.toEqual({
      allowed: false,
      reason: "The fire alarm is on.",
    });
  });

  it("writes in a folder of the session's own, which the session may read", async () => {
    const { call, decide } = session(READ_ONLY_GIT);

    expect(paths.isWithin(call.outputFolder, sessionTemporaryFolder(paths, SESSION_ID))).toBe(true);
    await expect(
      decide("Read", { file_path: join(call.outputFolder, "command.log") }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      decide("Read", { file_path: join(sessionTemporaryFolder(paths, "another"), "x.log") }),
    ).resolves.toMatchObject({ allowed: false });
  });
});

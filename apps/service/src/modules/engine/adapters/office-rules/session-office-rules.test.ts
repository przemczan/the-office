import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { FIRST_CLAUDE_CODE_ENGINE } from "../../domain/engines.js";
import type { PermissionProfile } from "../../domain/permission-profile.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { sessionOfficeRules } from "./session-office-rules.js";
import { toolDecision } from "./tool-decision.js";

const SESSION_ID = "5d1c7e0a-8b2f-4c3d-9e4f-0a1b2c3d4e5f";
const operatingSystem = currentOperatingSystem();
const officeData = new OfficeDataDirectory(join(tmpdir(), "office"));
const BASES = officeData.folder("bases");
const INITIATIVE_BASES = join(officeData.folder("initiative-bases"), "sync");

/** As a chat's: it only reads. */
const READ_ONLY: PermissionProfile = {
  edit: false,
  run: { kind: "read-only-git" },
  web: false,
  mcpTools: {},
};

/** A session on an Initiative's Thread, working in the base checkouts, reading `readableFolders`. */
function decide(
  profile: PermissionProfile,
  readableFolders: readonly string[] | undefined,
  tool: string,
  input: unknown,
) {
  const options: SessionOptions = {
    folder: BASES,
    ...(readableFolders !== undefined && { readableFolders }),
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
  return toolDecision(rules, {}, tool, input);
}

describe("a session's readable folders", () => {
  const onTheBranch = join(INITIATIVE_BASES, "admin-panel", "README.md");

  it("lets the session read inside them, as inside its own folder", async () => {
    await expect(
      decide(READ_ONLY, [INITIATIVE_BASES], "Read", { file_path: onTheBranch }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      decide(READ_ONLY, [INITIATIVE_BASES], "Read", {
        file_path: join(BASES, "admin-panel", "README.md"),
      }),
    ).resolves.toEqual({ allowed: true });
  });

  it("refuses reads outside them and its own folder, and inside them when it isn't given them", async () => {
    const elsewhere = join(officeData.folder("initiative-bases"), "other", "admin-panel", "a.ts");

    await expect(
      decide(READ_ONLY, [INITIATIVE_BASES], "Read", { file_path: elsewhere }),
    ).resolves.toMatchObject({ allowed: false });
    await expect(
      decide(READ_ONLY, [INITIATIVE_BASES], "Read", {
        file_path: join(officeData.folder("worktrees"), "task-1", "a.ts"),
      }),
    ).resolves.toMatchObject({ allowed: false });
    await expect(
      decide(READ_ONLY, undefined, "Read", { file_path: onTheBranch }),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("refuses edits inside them, even under a profile that edits", async () => {
    for (const profile of [READ_ONLY, { ...READ_ONLY, edit: true }]) {
      await expect(
        decide(profile, [INITIATIVE_BASES], "Edit", {
          file_path: onTheBranch,
          old_string: "a",
          new_string: "b",
        }),
      ).resolves.toMatchObject({ allowed: false });
      await expect(
        decide(profile, [INITIATIVE_BASES], "Write", { file_path: onTheBranch, content: "b" }),
      ).resolves.toMatchObject({ allowed: false });
    }
  });
});

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { FIRST_CLAUDE_CODE_ENGINE } from "../../domain/engines.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { toolDecision } from "../office-rules/tool-decision.js";
import { McpConfigFile, type McpConfig } from "./mcp-config-file.js";
import { claudeCodeOfficeRules } from "./session-office-rules.js";

const SESSION_ID = "0b0e6a47-3f9e-4f8e-9a51-2a3c4d5e6f70";

const CONFIG: McpConfig = {
  mcpServers: {
    github: { type: "stdio", command: "npx", args: [], env: { GITHUB_TOKEN: "secret" } },
  },
};

let officeData: string;

beforeEach(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-mcp-config-"));
});

afterEach(async () => {
  await rm(officeData, { recursive: true, force: true });
});

const sessionsFolder = () => join(officeData, "sessions");

describe("McpConfigFile", () => {
  it("writes the config in the session's folder of the Office data directory", async () => {
    const file = await McpConfigFile.write(sessionsFolder(), SESSION_ID, CONFIG);

    expect(file.path.startsWith(join(sessionsFolder(), SESSION_ID))).toBe(true);
    expect(JSON.parse(await readFile(file.path, "utf8"))).toEqual(CONFIG);
  });

  // Windows has no file modes: the file takes the data directory's access list.
  it.skipIf(currentOperatingSystem().name === "Windows")(
    "lets only its owner read it",
    async () => {
      const file = await McpConfigFile.write(sessionsFolder(), SESSION_ID, CONFIG);

      expect((await stat(file.path)).mode & 0o777).toBe(0o600);
    },
  );

  it("gives each start and resume its own file, which removing leaves the other's", async () => {
    const ended = await McpConfigFile.write(sessionsFolder(), SESSION_ID, CONFIG);
    const resumed = await McpConfigFile.write(sessionsFolder(), SESSION_ID, CONFIG);

    await ended.remove();

    await expect(stat(ended.path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(resumed.path, "utf8"))).toEqual(CONFIG);
  });

  it("is refused to the session's Agent, while its skills beside it stay readable", async () => {
    const file = await McpConfigFile.write(sessionsFolder(), SESSION_ID, CONFIG);
    const skillsFolder = join(sessionsFolder(), SESSION_ID, "skills");
    const options: SessionOptions = {
      deferredOfficeTools: [],
      folder: join(officeData, "worktrees", "task-1"),
      environment: {},
      engine: FIRST_CLAUDE_CODE_ENGINE,
      model: "claude-haiku-5-5",
      effort: "medium",
      skills: { folder: skillsFolder, names: [], expected: [], userOnly: [], overrides: {} },
      profile: { edit: true, run: { kind: "anything" }, web: true, mcpTools: {} },
      officeTools: [],
      mcpServers: [],
      languageServers: [],
      instructions: "",
      outputSchema: undefined,
    };
    const rules = claudeCodeOfficeRules(
      currentOperatingSystem(),
      new OfficeDataDirectory(officeData),
      { sessionId: SESSION_ID, configFolder: join(officeData, "engines", "claude-code") },
      options,
    );
    const decide = (tool: string, input: unknown) => toolDecision(rules, {}, tool, input);

    await expect(decide("Read", { file_path: file.path })).resolves.toMatchObject({
      allowed: false,
    });
    await expect(decide("Bash", { command: `cat "${file.path}"` })).resolves.toMatchObject({
      allowed: false,
    });
    await expect(
      decide("Read", { file_path: join(skillsFolder, "tdd", "SKILL.md") }),
    ).resolves.toEqual({ allowed: true });
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Query, SDKSystemMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import type { SessionSkills } from "../../ports/session-options.js";
import { initProblems, startCheckProblems } from "./start-check.js";

const { paths } = currentOperatingSystem();
let folder: string;
let skills: SessionSkills;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-start-check-"));
  skills = {
    folder,
    names: ["office:tdd", "deploy"],
    expected: ["deploy", "office:tdd"],
    overrides: {},
  };
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

interface EngineAnswers {
  readonly plugins?: readonly { name: string; path: string }[];
  readonly errorCount?: number;
  readonly held?: boolean;
  readonly listed?: readonly string[];
}

/** The two control calls the start check makes, answered as given. */
function anEngine({
  plugins = [{ name: "office", path: folder }],
  errorCount = 0,
  held = false,
  listed = ["office:tdd", "deploy"],
}: EngineAnswers = {}): Query {
  return {
    reloadPlugins: () =>
      Promise.resolve({
        plugins,
        error_count: errorCount,
        held,
        commands: [],
        agents: [],
        mcpServers: [],
      }),
    getContextUsage: () =>
      Promise.resolve({ skills: { skillFrontmatter: listed.map((name) => ({ name })) } }),
  } as unknown as Query;
}

describe("startCheckProblems", () => {
  it("passes a session listing exactly its skills from its own plugin", async () => {
    await expect(startCheckProblems(anEngine(), skills, paths)).resolves.toEqual([]);
  });

  it("names every skill missing from the listing and every one it shouldn't have", async () => {
    const engine = anEngine({ listed: ["office:tdd", "vendor:deploy", "lint"] });

    await expect(startCheckProblems(engine, skills, paths)).resolves.toEqual([
      "It doesn't list deploy.",
      "It lists lint, vendor:deploy, which it shouldn't have.",
    ]);
  });

  it("refuses when its plugin isn't loaded from its folder, or the engine reports errors", async () => {
    const engine = anEngine({
      plugins: [{ name: "office", path: join(folder, "elsewhere") }],
      errorCount: 2,
    });

    await expect(startCheckProblems(engine, skills, paths)).resolves.toEqual([
      "The engine reports 2 plugin errors.",
      `The engine didn't load its skills folder ${folder} as the office plugin.`,
    ]);
  });

  it("refuses a reload the engine held", async () => {
    await expect(startCheckProblems(anEngine({ held: true }), skills, paths)).resolves.toEqual([
      "The engine held the plugin reload, which would have changed the cached prompt.",
    ]);
  });

  it("expects no skill at all of a session without skills", async () => {
    const engine = anEngine({ plugins: [], listed: ["deploy"] });

    await expect(startCheckProblems(engine, undefined, paths)).resolves.toEqual([
      "It lists deploy, which it shouldn't have.",
    ]);
  });

  it("takes the folder by another spelling of its path as the same", async () => {
    const engine = anEngine({ plugins: [{ name: "office", path: join(folder, ".", "") }] });

    await expect(startCheckProblems(engine, skills, paths)).resolves.toEqual([]);
  });
});

function init(fields: Partial<SDKSystemMessage>): SDKSystemMessage {
  return fields as SDKSystemMessage;
}

describe("initProblems", () => {
  it("passes an init with its plugin and no errors", async () => {
    await expect(
      initProblems(
        init({ plugins: [{ name: "office", path: folder }], plugin_errors: [] }),
        skills,
        paths,
      ),
    ).resolves.toEqual([]);
  });

  it("names what disagrees with the start check", async () => {
    const message = init({
      plugins: [],
      plugin_errors: [{ plugin: "office", type: "manifest" }] as SDKSystemMessage["plugin_errors"],
    });

    await expect(initProblems(message, skills, paths)).resolves.toEqual([
      "The engine reports a plugin error.",
      `The engine didn't load its skills folder ${folder} as the office plugin.`,
    ]);
  });
});

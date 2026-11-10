import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import type { SessionSkills } from "../../ports/session-options.js";
import { type StartCheckRequests } from "./start-check.js";

// What start-check.test.ts and start-check.full.test.ts share.

export const { paths } = currentOperatingSystem();

export let folder: string;

export let skills: SessionSkills;

export interface EngineAnswers {
  readonly plugins?: readonly { name: string; path: string }[];
  readonly errorCount?: number;
  readonly held?: boolean;
  readonly listed?: readonly string[];
}

/** The two control calls the start check makes, answered as given. */
export function anEngine({
  plugins = [{ name: "office", path: folder }],
  errorCount = 0,
  held = false,
  listed = ["office:tdd", "deploy"],
}: EngineAnswers = {}): StartCheckRequests {
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
  } as unknown as StartCheckRequests;
}

/** The hooks every test of both files runs. */
export function setUpEachTest(): void {
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
}

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { ReadFiles, type BuiltInTool, type ToolContext, type ToolOutput } from "./built-in-tool.js";

// What file-tools.test.ts and file-tools.full.test.ts share.

export let folder: string;

export let context: ToolContext;

export async function run(tool: BuiltInTool, input: unknown): Promise<ToolOutput> {
  const prepared = tool.prepare(input);
  if (!prepared.valid) throw new Error(prepared.problem);
  return prepared.run(context, new AbortController().signal);
}

export async function files(names: Readonly<Record<string, string>>): Promise<void> {
  for (const [name, content] of Object.entries(names)) {
    await mkdir(join(folder, name, ".."), { recursive: true });
    await writeFile(join(folder, name), content);
  }
}

/** The hooks every test of both files runs. */
export function setUpEachTest(): void {
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "office-file-tools-"));
    const paths = currentOperatingSystem().paths;
    context = {
      folder,
      environment: {},
      paths,
      mayRead: (path) => !paths.names(path).includes("private"),
      readFiles: new ReadFiles(),
    };
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });
}

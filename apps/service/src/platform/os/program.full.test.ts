import { once } from "node:events";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { currentOperatingSystem } from "./current-operating-system.js";
import { isOnPath, startProgram } from "./program.js";
import { isRunning } from "./process-trees.fixtures.js";

const { paths, processTrees } = currentOperatingSystem();

const inherited = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

describe("startProgram", () => {
  it("starts it so that its tree can be ended", { timeout: 30_000 }, async () => {
    const child = startProgram(
      {
        command: process.execPath,
        arguments: ["-e", "setInterval(() => {}, 1000)"],
        workingFolder: tmpdir(),
        environment: inherited,
      },
      processTrees,
    );
    await once(child, "spawn");
    const processId = child.pid ?? 0;

    await processTrees.end(processId);

    expect(isRunning(processId)).toBe(false);
  });
});

async function inFolderHolding<Result>(
  file: string,
  use: (folder: string) => Promise<Result>,
): Promise<Result> {
  const folder = await mkdtemp(join(tmpdir(), "office-on-path-"));
  try {
    await writeFile(join(folder, file), "");
    await chmod(join(folder, file), 0o755);
    return await use(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

describe("isOnPath", () => {
  const exactCase = { paths, sameVariableName: (one: string, other: string) => one === other };
  const anyCase = {
    paths,
    sameVariableName: (one: string, other: string) => one.toUpperCase() === other.toUpperCase(),
  };

  it("finds a command in any folder of PATH, and no other", async () => {
    await inFolderHolding("server", async (folder) => {
      const environment = { PATH: ["/no/such/folder", folder].join(paths.pathListSeparator) };

      expect(await isOnPath("server", environment, exactCase)).toBe(true);
      expect(await isOnPath("other-server", environment, exactCase)).toBe(false);
    });
  });

  it("finds nothing with no PATH", async () => {
    expect(await isOnPath("node", {}, exactCase)).toBe(false);
  });

  it("finds a command under a PATHEXT ending, however the variables are cased", async () => {
    await inFolderHolding("server.cmd", async (folder) => {
      const environment = { Path: folder, PathExt: ".EXE;.cmd" };

      expect(await isOnPath("server", environment, anyCase)).toBe(true);
    });
  });
});

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LANGUAGE_SERVERS } from "../../domain/language-servers.js";
import { writeLanguageServerPlugin } from "./language-server-plugin.js";

describe("writeLanguageServerPlugin", () => {
  let sessions: string;

  beforeEach(async () => {
    sessions = await mkdtemp(join(tmpdir(), "office-language-server-plugin-"));
  });

  afterEach(async () => {
    await rm(sessions, { recursive: true, force: true });
  });

  it("writes none for a session with no server", async () => {
    await expect(writeLanguageServerPlugin(sessions, "s1", [])).resolves.toBeUndefined();
  });

  it("names each server as the engine reads it, with what keeps its answers right", async () => {
    const folder = await writeLanguageServerPlugin(sessions, "s1", LANGUAGE_SERVERS);

    expect(folder).toBe(join(sessions, "s1", "language-servers"));
    const manifest: unknown = JSON.parse(
      await readFile(
        join(sessions, "s1", "language-servers", ".claude-plugin", "plugin.json"),
        "utf8",
      ),
    );
    expect(manifest).toMatchObject({
      name: "office-language-servers",
      lspServers: {
        "typescript-language-server": {
          command: "typescript-language-server",
          args: ["--stdio"],
          initializationOptions: { tsserver: { useSyntaxServer: "never" } },
        },
        clangd: { args: ["--background-index=false"] },
        "kotlin-lsp": { extensionToLanguage: { ".kt": "kotlin" } },
      },
    });
  });
});

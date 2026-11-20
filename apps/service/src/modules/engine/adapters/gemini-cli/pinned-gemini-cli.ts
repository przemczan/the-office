import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const CLI_PACKAGE = "@google/gemini-cli";

interface CliManifest {
  readonly bin: { readonly gemini: string };
}

/**
 * The pinned `@google/gemini-cli`'s JS entry (`bundle/gemini.js`), which a session runs with the
 * Node The Office runs on, so no `.cmd` shim stands between them on Windows (spec §5.4.7).
 */
export function pinnedGeminiCliEntry(): string {
  const manifestPath = createRequire(import.meta.url).resolve(`${CLI_PACKAGE}/package.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as CliManifest;
  return join(dirname(manifestPath), manifest.bin.gemini);
}

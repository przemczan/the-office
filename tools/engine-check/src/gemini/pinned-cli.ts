import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const CLI_PACKAGE = "@google/gemini-cli";

interface CliManifest {
  readonly version: string;
  readonly bin: { readonly gemini: string };
}

/**
 * The pinned CLI's JS entry (`bundle/gemini.js`), which a session runs with `process.execPath`, so no
 * `.cmd` shim stands between it and The Office on Windows.
 */
export function pinnedCliEntry(): string {
  const { manifestPath, manifest } = readManifest();
  return join(dirname(manifestPath), manifest.bin.gemini);
}

export function pinnedCliVersion(): string {
  return readManifest().manifest.version;
}

function readManifest(): { manifestPath: string; manifest: CliManifest } {
  const manifestPath = createRequire(import.meta.url).resolve(`${CLI_PACKAGE}/package.json`);
  return { manifestPath, manifest: JSON.parse(readFileSync(manifestPath, "utf8")) as CliManifest };
}

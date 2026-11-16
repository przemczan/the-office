import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** The launcher package; npm installs one of its platform packages, `<launcher>-<platform>-<arch>`, beside it. */
const CODEX_PACKAGE = "@openai/codex";

/** The Rust target each platform package carries its binary under, as the launcher (`bin/codex.js`) maps them. */
const TARGETS: Readonly<Record<string, string>> = {
  "linux-x64": "x86_64-unknown-linux-musl",
  "linux-arm64": "aarch64-unknown-linux-musl",
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc",
};

/**
 * The native `codex` binary of the pinned @openai/codex, found as its launcher finds it. Run directly,
 * not through the Node launcher, so a signal or a kill reaches the app-server itself.
 */
export function pinnedCodexPath(): string {
  const platform = `${process.platform}-${process.arch}`;
  const target = TARGETS[platform];
  if (target === undefined) {
    throw new Error(`No Codex binary for ${platform}`);
  }
  const launcherRequire = createRequire(import.meta.resolve(`${CODEX_PACKAGE}/package.json`));
  const platformPackage = launcherRequire.resolve(`${CODEX_PACKAGE}-${platform}/package.json`);
  const executable = process.platform === "win32" ? "codex.exe" : "codex";
  return join(dirname(platformPackage), "vendor", target, "bin", executable);
}

/** The version tools/engine-check/package.json pins, which the app-server must report in its user agent. */
export function pinnedCodexVersion(): string {
  const manifest = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { dependencies: Record<string, string> };
  const version = manifest.dependencies[CODEX_PACKAGE];
  if (version === undefined) {
    throw new Error(`${CODEX_PACKAGE} is not pinned in tools/engine-check/package.json`);
  }
  return version;
}

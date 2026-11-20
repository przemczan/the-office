import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** The launcher package, pinned exactly; npm installs one of its platform packages beside it. */
const CODEX_PACKAGE = "@openai/codex";

/**
 * The native binary of the pinned `@openai/codex` (spec §5.4 Defaults), found as its launcher
 * finds it: in the platform package `codexBinary` names (`<suffix>/<path in it>`, the platform's),
 * resolved from the launcher's own folder, where npm puts its optional dependencies. Run directly,
 * not through the Node launcher, so ending its process tree ends the app-server itself.
 */
export function pinnedCodexPath(codexBinary: string | undefined): string {
  if (codexBinary === undefined) {
    throw new Error(`${CODEX_PACKAGE} has no build for this processor (${process.arch}).`);
  }
  const separator = codexBinary.indexOf("/");
  const suffix = codexBinary.slice(0, separator);
  const pathInPackage = codexBinary.slice(separator + 1);
  const launcherRequire = createRequire(
    createRequire(import.meta.url).resolve(`${CODEX_PACKAGE}/package.json`),
  );
  let platformPackage: string;
  try {
    platformPackage = dirname(launcherRequire.resolve(`${CODEX_PACKAGE}-${suffix}/package.json`));
  } catch {
    throw new Error(
      `No Codex binary beside ${CODEX_PACKAGE}: ${CODEX_PACKAGE}-${suffix} isn't installed.`,
    );
  }
  const binary = join(platformPackage, ...pathInPackage.split("/"));
  if (!existsSync(binary)) throw new Error(`No Codex binary at ${binary}.`);
  return binary;
}

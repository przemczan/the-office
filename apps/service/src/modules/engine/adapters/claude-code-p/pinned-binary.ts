import { existsSync } from "node:fs";
import { createRequire } from "node:module";

/** The SDK; npm installs one of its platform packages, `<SDK>-<suffix>`, beside it with the binary. */
const SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk";

/**
 * The Claude Code binary the pinned SDK bundles (spec §5.4 Defaults), found as the SDK finds it:
 * the first of this system's builds that is installed, resolved from the SDK's own folder, where
 * npm puts its optional dependencies.
 */
export function pinnedBinaryPath(claudeCodeBinaries: readonly string[]): string {
  const sdkRequire = createRequire(createRequire(import.meta.url).resolve(SDK_PACKAGE));
  for (const binary of claudeCodeBinaries) {
    try {
      const path = sdkRequire.resolve(`${SDK_PACKAGE}-${binary}`);
      if (existsSync(path)) return path;
    } catch {
      // This build isn't installed; the next may be.
    }
  }
  throw new Error(
    `No Claude Code binary beside the Agent SDK: none of ${claudeCodeBinaries.join(", ")}.`,
  );
}

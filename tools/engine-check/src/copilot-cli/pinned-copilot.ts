import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface PinnedCopilot {
  /** The `@microsoft/copilot-sdk` version pinned in package.json. */
  readonly sdk: string;
  /** The Copilot CLI runtime the SDK's platform package bundles (`copilotCliVersion`). */
  readonly runtime: string;
}

/** The pinned SDK and its runtime, from the installed package (its `exports` hide package.json from require). */
export function pinnedCopilot(): PinnedCopilot {
  const entry = fileURLToPath(import.meta.resolve("@microsoft/copilot-sdk"));
  const manifest = JSON.parse(readFileSync(join(dirname(entry), "..", "package.json"), "utf8")) as {
    version: string;
    copilotCliVersion: string;
  };
  return { sdk: manifest.version, runtime: manifest.copilotCliVersion };
}

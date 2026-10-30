import { existsSync } from "node:fs";
import { createRequire } from "node:module";

/** The SDK; npm installs one of its platform packages, `<SDK>-<platform>-<arch>`, beside it with the binary. */
const SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk";

/**
 * The Claude Code binary the pinned SDK bundles (spec §5.4 Defaults), found as the SDK finds it: the
 * package for this platform and architecture, on Linux the glibc build first unless the system has
 * no glibc. Resolved from the SDK's own folder, where npm puts its optional dependencies.
 */
export function pinnedBinaryPath(): string {
  const sdkRequire = createRequire(import.meta.resolve(SDK_PACKAGE));
  for (const candidate of binaryCandidates()) {
    try {
      const path = sdkRequire.resolve(candidate);
      if (existsSync(path)) {
        return path;
      }
    } catch {
      // Not installed on this platform; the next candidate may be.
    }
  }
  throw new Error(`No Claude Code binary for ${process.platform}-${process.arch} beside the SDK`);
}

function binaryCandidates(): string[] {
  const { platform, arch } = process;
  const executable = platform === "win32" ? "claude.exe" : "claude";
  const packages =
    platform === "linux"
      ? hasGlibc()
        ? [`linux-${arch}`, `linux-${arch}-musl`]
        : [`linux-${arch}-musl`, `linux-${arch}`]
      : [`${platform}-${arch}`];
  return packages.map((suffix) => `${SDK_PACKAGE}-${suffix}/${executable}`);
}

function hasGlibc(): boolean {
  const report = process.report.getReport() as { header?: { glibcVersionRuntime?: string } };
  return report.header?.glibcVersionRuntime !== undefined;
}

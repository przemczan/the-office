/** The processors `@openai/codex` has a build for, by Node's name and the Rust target's first part. */
const CODEX_PROCESSORS: Readonly<Record<string, string>> = {
  x64: "x86_64",
  arm64: "aarch64",
};

/**
 * Where the pinned `@openai/codex` keeps its native binary for this processor, as its launcher
 * (`bin/codex.js`) finds it: in the platform package `<platform>-<arch>`, under
 * `vendor/<Rust target>/bin/`. Undefined on a processor it has no build for.
 */
export function codexBuild(
  platform: string,
  targetSuffix: string,
  executable: string,
  architecture: string = process.arch,
): string | undefined {
  const processor = CODEX_PROCESSORS[architecture];
  if (processor === undefined) return undefined;
  return `${platform}-${architecture}/vendor/${processor}-${targetSuffix}/bin/${executable}`;
}

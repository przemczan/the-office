/**
 * A language server a session's LSP tool may run (spec §5.4). `arguments` and
 * `initializationOptions` are what keep its answers right and its folder clean, as
 * docs/language-servers.md says of each.
 */
export interface LanguageServer {
  /** In the words the brief uses. */
  readonly name: string;
  /** Found on the session's PATH. */
  readonly command: string;
  readonly arguments: readonly string[];
  /** The language id of each file extension it serves. */
  readonly languages: Readonly<Record<string, string>>;
  readonly initializationOptions?: Readonly<Record<string, unknown>>;
}

/** The servers docs/language-servers.md installs on the workstation, the same for every Role. */
export const LANGUAGE_SERVERS: readonly LanguageServer[] = [
  {
    name: "TypeScript",
    command: "typescript-language-server",
    arguments: ["--stdio"],
    languages: {
      ".ts": "typescript",
      ".mts": "typescript",
      ".cts": "typescript",
      ".tsx": "typescriptreact",
      ".js": "javascript",
      ".mjs": "javascript",
      ".cjs": "javascript",
      ".jsx": "javascriptreact",
    },
    // Its syntax server answers while the project loads, stopping a definition at the import line.
    initializationOptions: { tsserver: { useSyntaxServer: "never" } },
  },
  {
    name: "C and C++",
    command: "clangd",
    // Its background index would write `.cache/clangd` into the session's folder.
    arguments: ["--background-index=false"],
    languages: {
      ".c": "c",
      ".h": "cpp",
      ".cc": "cpp",
      ".cpp": "cpp",
      ".cxx": "cpp",
      ".hh": "cpp",
      ".hpp": "cpp",
      ".hxx": "cpp",
    },
  },
  {
    name: "Kotlin",
    command: "kotlin-lsp",
    arguments: ["--stdio"],
    languages: { ".kt": "kotlin", ".kts": "kotlin" },
  },
];

/**
 * A session's first message led by the language servers it doesn't get, so the Agent knows why the
 * LSP tool doesn't answer for their files (spec §5.4).
 */
export function withLeftOutLanguageServers(
  text: string,
  leftOut: readonly LanguageServer[],
): string {
  if (leftOut.length === 0) return text;
  const lines = leftOut.map(({ name, command }) => `- ${name}: \`${command}\` isn't installed`);
  return `## Language servers left out\n\nThese language servers are not in this session, so the LSP tool doesn't answer for their files:\n\n${lines.join("\n")}\n\n${text}`;
}

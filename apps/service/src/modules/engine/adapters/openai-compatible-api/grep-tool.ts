import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { z } from "zod";
import {
  builtInTool,
  failure,
  resolvedPath,
  success,
  type ToolContext,
  type ToolOutput,
} from "./built-in-tool.js";
import { fileProblem, isBinary } from "./file-problems.js";
import { listedFiles, type ListedFile } from "./file-listing.js";
import {
  matchCount,
  matchingLines,
  splitLines,
  textSearch,
  type SearchContext,
  type TextSearch,
} from "./text-search.js";

/** As many lines or entries as Grep shows without a `head_limit`. */
const DEFAULT_HEAD_LIMIT = 250;

/** The file types `type` names, by ripgrep's names for the common ones. */
const FILE_TYPES: Readonly<Record<string, readonly string[]>> = {
  c: [".c", ".h"],
  cpp: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".h"],
  cs: [".cs"],
  css: [".css", ".scss", ".sass", ".less"],
  go: [".go"],
  html: [".html", ".htm"],
  java: [".java"],
  js: [".js", ".jsx", ".mjs", ".cjs"],
  json: [".json"],
  kotlin: [".kt", ".kts"],
  md: [".md", ".markdown"],
  php: [".php"],
  py: [".py", ".pyi"],
  ruby: [".rb"],
  rust: [".rs"],
  sh: [".sh", ".bash"],
  sql: [".sql"],
  swift: [".swift"],
  toml: [".toml"],
  ts: [".ts", ".tsx", ".mts", ".cts"],
  xml: [".xml"],
  yaml: [".yaml", ".yml"],
};

const lineCount = z.number().int().nonnegative();

const grepInput = z.object({
  pattern: z.string().describe("The regular expression pattern to search for in file contents"),
  path: z
    .string()
    .optional()
    .describe("File or directory to search in. Defaults to current working directory."),
  glob: z.string().optional().describe('Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}")'),
  output_mode: z
    .enum(["content", "files_with_matches", "count"])
    .default("files_with_matches")
    .describe(
      'Output mode: "content" shows matching lines, "files_with_matches" shows file paths, "count" shows match counts. Defaults to "files_with_matches".',
    ),
  "-B": lineCount
    .optional()
    .describe("Number of lines to show before each match. Content mode only."),
  "-A": lineCount
    .optional()
    .describe("Number of lines to show after each match. Content mode only."),
  "-C": lineCount.optional().describe("Alias for context."),
  context: lineCount
    .optional()
    .describe("Number of lines to show before and after each match. Content mode only."),
  "-n": z.boolean().default(true).describe("Show line numbers in output. Content mode only."),
  "-i": z.boolean().default(false).describe("Case insensitive search"),
  "-o": z
    .boolean()
    .default(false)
    .describe("Print only the matched parts of each matching line. Content mode only."),
  type: z
    .string()
    .optional()
    .describe(`File type to search: ${Object.keys(FILE_TYPES).join(", ")}.`),
  head_limit: lineCount
    .optional()
    .describe(
      `Limit output to the first N lines or entries. Defaults to ${DEFAULT_HEAD_LIMIT}; 0 for unlimited.`,
    ),
  offset: lineCount.default(0).describe("Skip the first N lines or entries before head_limit."),
  multiline: z
    .boolean()
    .default(false)
    .describe("Enable multiline mode where . matches newlines and patterns can span lines."),
});

type GrepInput = z.infer<typeof grepInput>;

/** Claude Code's Grep: a regular expression searched for in the session's readable files. */
export const GREP_TOOL = builtInTool({
  name: "Grep",
  description: [
    "Searches file contents for a regular expression (JavaScript syntax).",
    "- Filter files with glob or type; skips .git and node_modules folders and binary files.",
    '- output_mode: "content" shows matching lines, "files_with_matches" (the default) only paths, "count" counts per file.',
  ].join("\n"),
  input: grepInput,
  run: async (input, context) => {
    const search = textSearch(input.pattern, {
      ignoreCase: input["-i"],
      multiline: input.multiline,
    });
    if ("problem" in search) return failure(search.problem);
    if (input.type !== undefined && FILE_TYPES[input.type] === undefined) {
      return failure(`Unknown type ${input.type}; known: ${Object.keys(FILE_TYPES).join(", ")}.`);
    }
    const files = await searchedFiles(input, context);
    if ("problem" in files) return failure(files.problem);
    return output(input, search, await readable(files));
  },
});

interface SearchedFile extends ListedFile {
  readonly lines: readonly string[];
}

/** The file `path` names, or the files under it that `glob` and `type` let through. */
async function searchedFiles(
  input: GrepInput,
  context: ToolContext,
): Promise<ListedFile[] | { readonly problem: string }> {
  const root = resolvedPath(context, input.path ?? ".");
  let isFile: boolean;
  let modifiedMs: number;
  try {
    const found = await stat(root);
    isFile = found.isFile();
    modifiedMs = found.mtimeMs;
  } catch (error) {
    return { problem: fileProblem(input.path ?? ".", error) };
  }
  if (isFile) return context.mayRead(root) ? [{ path: root, modifiedMs }] : [];
  // The glob filters names under the searched folder, as ripgrep's does: one without a `/` matches a name at any depth.
  const pattern =
    input.glob === undefined ? "**/*" : input.glob.includes("/") ? input.glob : `**/${input.glob}`;
  const extensions = input.type === undefined ? undefined : FILE_TYPES[input.type];
  const listed = await listedFiles(root, pattern, context);
  return extensions === undefined
    ? listed
    : listed.filter((file) => extensions.includes(extname(file.path).toLowerCase()));
}

async function readable(files: readonly ListedFile[]): Promise<SearchedFile[]> {
  const read: SearchedFile[] = [];
  for (const file of files) {
    let content: Buffer;
    try {
      content = await readFile(file.path);
    } catch {
      continue;
    }
    if (!isBinary(content)) read.push({ ...file, lines: splitLines(content.toString("utf8")) });
  }
  return read;
}

function output(input: GrepInput, search: TextSearch, files: readonly SearchedFile[]): ToolOutput {
  const counted = files
    .map((file) => ({ file, count: matchCount(search, file.lines) }))
    .filter(({ count }) => count > 0);
  if (counted.length === 0) return success("No matches found");
  switch (input.output_mode) {
    case "files_with_matches": {
      const paths = page(
        input,
        counted.map(({ file }) => file.path),
      );
      return success([`Found ${counted.length} files`, ...paths].join("\n"));
    }
    case "count": {
      const total = counted.reduce((sum, { count }) => sum + count, 0);
      const entries = page(
        input,
        counted.map(({ file, count }) => `${file.path}:${count}`),
      );
      return success(
        [...entries, "", `Found ${total} total occurrences across ${counted.length} files.`].join(
          "\n",
        ),
      );
    }
    case "content": {
      const lines = counted.flatMap(({ file }) =>
        matchingLines(file.path, search, file.lines, {
          context: contextOf(input),
          lineNumbers: input["-n"],
          onlyMatching: input["-o"],
        }),
      );
      return success(page(input, lines).join("\n"));
    }
  }
}

function contextOf(input: GrepInput): SearchContext {
  const around = input.context ?? input["-C"] ?? 0;
  return { before: input["-B"] ?? around, after: input["-A"] ?? around };
}

/** The entries `offset` and `head_limit` leave, with a line saying when some are left out. */
function page(input: GrepInput, entries: readonly string[]): string[] {
  const limit = input.head_limit ?? DEFAULT_HEAD_LIMIT;
  const from = entries.slice(input.offset);
  const shown = limit === 0 ? from : from.slice(0, limit);
  const left = from.length - shown.length;
  return left > 0
    ? [...shown, `(${left} more not shown; raise head_limit or offset to see them.)`]
    : shown;
}

import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { builtInTool, failure, resolvedPath, success, type ToolOutput } from "./built-in-tool.js";
import { fileProblem, isBinary } from "./file-problems.js";

/** As many lines as a Read gives without a limit. */
const DEFAULT_LINE_LIMIT = 2000;

/** A longer line is cut, so one minified file doesn't fill the context. */
const LONGEST_LINE = 2000;

/** A larger file is read only in parts, unless the model asks for all of it. */
const LARGEST_WHOLE_FILE_BYTES = 256 * 1024;

const readInput = z.object({
  file_path: z.string().describe("The absolute path to the file to read"),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "The line number to start reading from. Only provide if the file is too large to read at once",
    ),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "The number of lines to read. Only provide if the file is too large to read at once.",
    ),
  pages: z.string().optional().describe("Page range for PDF files. Not supported by this engine."),
  allow_large: z
    .boolean()
    .optional()
    .describe(
      "Set to true to read a text file, or a line range of one, that is over the usual size limits. Only use this when you genuinely need all of it.",
    ),
});

type ReadInput = z.infer<typeof readInput>;

/** Claude Code's Read: a text file's lines, numbered as `cat -n` numbers them. */
export const READ_TOOL = builtInTool({
  name: "Read",
  description: [
    "Reads a file from the local filesystem.",
    "- `file_path` must be an absolute path.",
    `- Reads up to ${DEFAULT_LINE_LIMIT} lines by default; give offset and limit to read a part of a long file.`,
    "- Results are returned using cat -n format, with line numbers starting at 1.",
    "- Read a file before editing or overwriting it.",
  ].join("\n"),
  input: readInput,
  run: async (input, context) => {
    const path = resolvedPath(context, input.file_path);
    if (input.pages !== undefined) return failure("This engine reads text files only, not PDFs.");
    let content: Buffer;
    try {
      const file = await stat(path);
      if (file.isDirectory()) {
        return failure(`${input.file_path} is a directory; list it with Glob instead.`);
      }
      if (file.size > LARGEST_WHOLE_FILE_BYTES && !readsPart(input) && input.allow_large !== true) {
        return failure(
          `${input.file_path} is ${Math.round(file.size / 1024)} KB, more than ${LARGEST_WHOLE_FILE_BYTES / 1024} KB; read it in parts with offset and limit, or search it with Grep.`,
        );
      }
      content = await readFile(path);
    } catch (error) {
      return failure(fileProblem(input.file_path, error));
    }
    if (isBinary(content)) return failure(`${input.file_path} is a binary file, not text.`);
    context.readFiles.add(path);
    return numberedLines(input, content.toString("utf8"));
  },
});

function readsPart(input: ReadInput): boolean {
  return input.offset !== undefined || input.limit !== undefined;
}

function numberedLines(input: ReadInput, text: string): ToolOutput {
  if (text === "") return success("(The file exists but is empty.)");
  const lines = text.replace(/\r?\n$/, "").split(/\r?\n/);
  const first = Math.max(input.offset ?? 1, 1);
  if (first > lines.length) {
    return success(`(The file has ${lines.length} lines; there is nothing from line ${first} on.)`);
  }
  const shown = lines.slice(first - 1, first - 1 + (input.limit ?? DEFAULT_LINE_LIMIT));
  const numbered = shown.map(
    (line, index) => `${String(first + index).padStart(6)}\t${cutLine(line)}`,
  );
  const last = first + shown.length - 1;
  const more =
    last < lines.length
      ? [`(Lines ${first}–${last} of ${lines.length}; read on with offset ${last + 1}.)`]
      : [];
  return success([...numbered, ...more].join("\n"));
}

function cutLine(line: string): string {
  return line.length > LONGEST_LINE ? `${line.slice(0, LONGEST_LINE)}… (line cut)` : line;
}

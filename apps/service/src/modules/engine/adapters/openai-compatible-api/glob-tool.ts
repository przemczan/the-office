import { stat } from "node:fs/promises";
import { z } from "zod";
import { builtInTool, failure, resolvedPath, success } from "./built-in-tool.js";
import { fileProblem } from "./file-problems.js";
import { listedFiles } from "./file-listing.js";

/** As many files as one Glob lists. */
const MOST_FILES = 100;

const globInput = z.object({
  pattern: z.string().describe("The glob pattern to match files against"),
  path: z
    .string()
    .optional()
    .describe(
      "The directory to search in. If not specified, the current working directory will be used. Omit this field to use the default directory.",
    ),
});

/** Claude Code's Glob: the files a pattern matches, the most recently changed first. */
export const GLOB_TOOL = builtInTool({
  name: "Glob",
  description: [
    'Fast file pattern matching, with patterns like "**/*.js" or "src/**/*.ts".',
    "- Returns matching file paths sorted by modification time, the most recent first.",
    "- Skips .git and node_modules folders.",
  ].join("\n"),
  input: globInput,
  run: async (input, context) => {
    const root = resolvedPath(context, input.path ?? ".");
    try {
      if (!(await stat(root)).isDirectory()) return failure(`${input.path} is not a directory.`);
    } catch (error) {
      return failure(fileProblem(input.path ?? ".", error));
    }
    const files = await listedFiles(root, input.pattern, context);
    if (files.length === 0) return success("No files found");
    const shown = files.slice(0, MOST_FILES).map((file) => file.path);
    const truncated =
      files.length > MOST_FILES
        ? ["(Results are truncated. Consider using a more specific path or pattern.)"]
        : [];
    return success([...shown, ...truncated].join("\n"));
  },
});

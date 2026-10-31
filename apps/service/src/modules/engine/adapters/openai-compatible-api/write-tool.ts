import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { builtInTool, failure, resolvedPath, success } from "./built-in-tool.js";
import { fileProblem, isMissing } from "./file-problems.js";

const writeInput = z.object({
  file_path: z
    .string()
    .describe("The absolute path to the file to write (must be absolute, not relative)"),
  content: z.string().describe("The content to write to the file"),
});

/** Claude Code's Write: a whole file, created with its folders or overwritten once it was read. */
export const WRITE_TOOL = builtInTool({
  name: "Write",
  description: [
    "Writes a file to the local filesystem, overwriting it if it exists.",
    "- An existing file must be read with Read first.",
    "- Prefer Edit for changing part of a file.",
  ].join("\n"),
  input: writeInput,
  run: async (input, context) => {
    const path = resolvedPath(context, input.file_path);
    let exists: boolean;
    try {
      await readFile(path);
      exists = true;
    } catch (error) {
      if (!isMissing(error)) return failure(fileProblem(input.file_path, error));
      exists = false;
    }
    if (exists && !context.readFiles.has(path)) {
      return failure(
        `${input.file_path} exists and hasn't been read yet; read it before writing it.`,
      );
    }
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, input.content, "utf8");
    } catch (error) {
      return failure(fileProblem(input.file_path, error));
    }
    context.readFiles.add(path);
    return success(
      exists
        ? `The file ${input.file_path} has been updated successfully.`
        : `File created successfully at: ${input.file_path}`,
    );
  },
});

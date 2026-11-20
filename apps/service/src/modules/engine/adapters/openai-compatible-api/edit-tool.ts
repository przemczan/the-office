import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { builtInTool, failure, resolvedPath, success } from "./built-in-tool.js";
import { fileProblem } from "../skills/file-problems.js";

const editInput = z.object({
  file_path: z.string().describe("The absolute path to the file to modify"),
  old_string: z.string().describe("The text to replace"),
  new_string: z
    .string()
    .describe("The text to replace it with (must be different from old_string)"),
  replace_all: z
    .boolean()
    .default(false)
    .describe("Replace all occurrences of old_string (default false)"),
});

type EditInput = z.infer<typeof editInput>;

/** Claude Code's Edit: exact text replaced in a file read before. */
export const EDIT_TOOL = builtInTool({
  name: "Edit",
  description: [
    "Performs exact string replacements in a file.",
    "- Read the file with Read before editing it.",
    "- old_string must match the file exactly, indentation included, and be unique unless replace_all is true.",
  ].join("\n"),
  input: editInput,
  run: async (input, context) => {
    const path = resolvedPath(context, input.file_path);
    if (input.old_string === input.new_string) {
      return failure("old_string and new_string are the same; there is nothing to change.");
    }
    if (!context.readFiles.has(path)) {
      return failure(`${input.file_path} hasn't been read yet; read it before editing it.`);
    }
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch (error) {
      return failure(fileProblem(input.file_path, error));
    }
    const edited = editedContent(content, input);
    if (typeof edited !== "string") return failure(edited.problem);
    try {
      await writeFile(path, edited, "utf8");
    } catch (error) {
      return failure(fileProblem(input.file_path, error));
    }
    return success(`The file ${input.file_path} has been updated successfully.`);
  },
});

/** The file with the edit made, or why it can't be. */
export function editedContent(
  content: string,
  input: Pick<EditInput, "old_string" | "new_string" | "replace_all">,
): string | { readonly problem: string } {
  if (input.old_string === "") return { problem: "old_string is empty; name the text to replace." };
  const { oldText, newText } = inLineEndingsOf(content, input);
  const found = content.split(oldText).length - 1;
  if (found === 0) return { problem: "old_string was not found in the file." };
  if (found > 1 && !input.replace_all) {
    return {
      problem: `old_string was found ${found} times; give more of the text around it to make it unique, or set replace_all to replace every one.`,
    };
  }
  return input.replace_all
    ? content.replaceAll(oldText, () => newText)
    : content.replace(oldText, () => newText);
}

/** A model writes `\n`; a file with Windows line endings is matched and edited in its own. */
function inLineEndingsOf(
  content: string,
  input: Pick<EditInput, "old_string" | "new_string">,
): { readonly oldText: string; readonly newText: string } {
  const windows = content.includes("\r\n") && !input.old_string.includes("\r");
  if (!windows || content.includes(input.old_string)) {
    return { oldText: input.old_string, newText: input.new_string };
  }
  return {
    oldText: input.old_string.replaceAll("\n", "\r\n"),
    newText: input.new_string.replaceAll("\n", "\r\n"),
  };
}

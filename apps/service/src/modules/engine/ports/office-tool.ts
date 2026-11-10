import type { z } from "zod";

/** The session's Office rules' decision on a command line: run it, or refuse it in these words. */
export type CommandJudgement =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

/** The session an Office tool is called from, so the tool can tell whose work it acts on. */
export interface OfficeToolCall {
  readonly sessionId: string;
  /**
   * A folder of the session's own that its Office rules let it read, for files a tool writes for
   * it to read, such as a command's output. It may not exist yet; it is removed with the session.
   */
  readonly outputFolder: string;
  /**
   * The session's Office rules' decision on `commandLine` as its own Bash call in its folder: its
   * profile, git, the container runtime and the secrets, and any hold on its calls, as the engine's
   * hook would decide it. For a tool that runs a command line the Agent wrote.
   */
  judgeCommand(commandLine: string): Promise<CommandJudgement>;
}

/** A picture an Office tool answers with, such as an image Attachment. */
export interface OfficeToolPicture {
  /** What the picture is called, for the words an engine answers in its place. */
  readonly name: string;
  /** One of the image types the model reads: PNG, JPEG, GIF or WebP. */
  readonly mediaType: string;
  readonly content: Uint8Array;
}

/**
 * What an Office tool answers the Agent: words, and pictures for the model to see. Each engine
 * adapter gives the pictures its own way, or says in words why it can't.
 */
export interface OfficeToolResult {
  readonly text: string;
  /** Whether the call failed; the Agent reads `text` either way. */
  readonly isError: boolean;
  readonly pictures?: readonly OfficeToolPicture[];
}

/**
 * A tool The Office gives Agents, run in-process by the service (spec §5.4), such as opening a
 * Decision or writing a Handover note.
 */
export interface OfficeTool<Input extends z.ZodObject = z.ZodObject> {
  /** Unique among Office tools; what the Agent calls it by. */
  readonly name: string;
  /** What the Agent reads to decide when to call it. */
  readonly description: string;
  readonly input: Input;
  run(input: z.output<Input>, call: OfficeToolCall): Promise<OfficeToolResult>;
}

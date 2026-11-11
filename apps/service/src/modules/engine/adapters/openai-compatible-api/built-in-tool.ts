import { z } from "zod";
import type { PathRules } from "../../../../platform/os/path-rules.js";
import type { ToolDefinition } from "./chat-completions.js";

/** What a built-in tool reads back to the model. */
export interface ToolOutput {
  readonly text: string;
  readonly isError: boolean;
  /**
   * Set when the engine refuses a call the Office rules allowed, as WebSearch is with no search
   * endpoint set: nothing ran, and the session reports a refusal by the engine.
   */
  readonly refused?: true;
}

/** What the session's tools work in and share. */
export interface SessionToolContext {
  /** The session's folder, which relative paths are resolved against, as the Office rules do. */
  readonly folder: string;
  /** The variables the session runs commands with. */
  readonly environment: Readonly<Record<string, string>>;
  readonly paths: PathRules;
  /**
   * Whether the session's Office rules let it read `path`. A listing (Glob, Grep) leaves out what
   * they don't, so a search never shows what a Read would be refused.
   */
  mayRead(path: string): boolean;
  /** The files read in this session, which Edit and Write ask for before they change one. */
  readonly readFiles: ReadFiles;
}

/** What one call runs in: the session's context, and the call's id. */
export interface ToolContext extends SessionToolContext {
  /** The id of the call being run, which a command it starts in the background is known by. */
  readonly callId: string;
}

/** The files a session has read or written, by their resolved paths. */
export class ReadFiles {
  private readonly files = new Set<string>();

  add(path: string): void {
    this.files.add(path);
  }

  has(path: string): boolean {
    return this.files.has(path);
  }
}

/** A call whose input has the tool's shape, ready to be judged and run. */
export interface PreparedCall {
  readonly valid: true;
  /** The input as the tool read it, defaults filled, which the Office rules judge. */
  readonly input: unknown;
  /** Runs the call; `signal` aborts when the turn is interrupted or the session ends. */
  run(context: ToolContext, signal: AbortSignal): Promise<ToolOutput>;
}

/** A call whose input the tool can't take, refused before the Office rules see it. */
export interface InvalidCall {
  readonly valid: false;
  readonly problem: string;
}

/** One of the loop's tools, under Claude Code's name and with its input. */
export interface BuiltInTool {
  /** As the model calls it: an Office tool under `OFFICE_TOOL_PREFIX`. */
  readonly name: string;
  readonly officeTool: boolean;
  readonly definition: ToolDefinition;
  prepare(input: unknown): PreparedCall | InvalidCall;
}

interface ToolSpecification<Input> {
  readonly name: string;
  readonly description: string;
  readonly input: z.ZodType<Input>;
  run(input: Input, context: ToolContext, signal: AbortSignal): Promise<ToolOutput>;
}

/** A tool whose input is checked against `input`, which also gives the model its JSON Schema. */
export function builtInTool<Input>(specification: ToolSpecification<Input>): BuiltInTool {
  const { $schema: _schema, ...parameters } = z.toJSONSchema(specification.input, {
    io: "input",
  });
  return {
    name: specification.name,
    officeTool: false,
    definition: {
      type: "function",
      function: {
        name: specification.name,
        description: specification.description,
        parameters,
      },
    },
    prepare(input) {
      const parsed = specification.input.safeParse(input);
      if (!parsed.success) {
        return { valid: false, problem: z.prettifyError(parsed.error) };
      }
      return {
        valid: true,
        input: parsed.data,
        run: (context, signal) => specification.run(parsed.data, context, signal),
      };
    },
  };
}

export function success(text: string): ToolOutput {
  return { text, isError: false };
}

export function failure(text: string): ToolOutput {
  return { text, isError: true };
}

export function engineRefusal(text: string): ToolOutput {
  return { text, isError: true, refused: true };
}

/** Where a tool's path names, resolved against the session's folder. */
export function resolvedPath(context: ToolContext, path: string): string {
  return context.paths.resolve(context.folder, path);
}

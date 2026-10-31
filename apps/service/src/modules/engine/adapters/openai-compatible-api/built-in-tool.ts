import { z } from "zod";
import type { PathRules } from "../../../../platform/os/path-rules.js";
import type { ToolDefinition } from "./chat-completions.js";

/** What a built-in tool reads back to the model. */
export interface ToolOutput {
  readonly text: string;
  readonly isError: boolean;
}

/** What the session's tools work in and share. */
export interface ToolContext {
  /** The session's folder, which relative paths are resolved against, as the Office rules do. */
  readonly folder: string;
  readonly paths: PathRules;
  /**
   * Whether the session's Office rules let it read `path`. A listing (Glob, Grep) leaves out what
   * they don't, so a search never shows what a Read would be refused.
   */
  mayRead(path: string): boolean;
  /** The files read in this session, which Edit and Write ask for before they change one. */
  readonly readFiles: ReadFiles;
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
  run(context: ToolContext): Promise<ToolOutput>;
}

/** A call whose input the tool can't take, refused before the Office rules see it. */
export interface InvalidCall {
  readonly valid: false;
  readonly problem: string;
}

/** One of the loop's tools, under Claude Code's name and with its input. */
export interface BuiltInTool {
  readonly name: string;
  readonly definition: ToolDefinition;
  prepare(input: unknown): PreparedCall | InvalidCall;
}

interface ToolSpecification<Input> {
  readonly name: string;
  readonly description: string;
  readonly input: z.ZodType<Input>;
  run(input: Input, context: ToolContext): Promise<ToolOutput>;
}

/** A tool whose input is checked against `input`, which also gives the model its JSON Schema. */
export function builtInTool<Input>(specification: ToolSpecification<Input>): BuiltInTool {
  const { $schema: _schema, ...parameters } = z.toJSONSchema(specification.input, {
    io: "input",
  });
  return {
    name: specification.name,
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
        run: (context) => specification.run(parsed.data, context),
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

/** Where a tool's path names, resolved against the session's folder. */
export function resolvedPath(context: ToolContext, path: string): string {
  return context.paths.resolve(context.folder, path);
}

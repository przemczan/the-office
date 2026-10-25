import type { OfficeToolRegistry } from "../../../engine/index.js";
import { AttachmentNotFound } from "../../domain/attachment-not-found.js";
import { AttachmentRefused } from "../../domain/attachment-refused.js";
import { IdeaNotFound } from "../../domain/idea-not-found.js";
import { IdeaRefused } from "../../domain/idea-refused.js";
import { TaskNotFound } from "../../domain/task-not-found.js";
import { TaskRefused } from "../../domain/task-refused.js";

export type OfficeToolResult = Awaited<
  ReturnType<Parameters<OfficeToolRegistry["register"]>[0]["run"]>
>;

/** A tool call The Office can't act on, answered to the Agent as an error. */
export class WorkToolRefused extends Error {}

/** Work's refusals answer the Agent in words it can act on; anything else fails the call. */
export async function answered(read: () => Promise<string>): Promise<OfficeToolResult> {
  try {
    return { text: await read(), isError: false };
  } catch (error) {
    if (isWorkRefusal(error)) return { text: error.message, isError: true };
    throw error;
  }
}

function isWorkRefusal(error: unknown): error is Error {
  return [
    IdeaRefused,
    TaskRefused,
    AttachmentRefused,
    IdeaNotFound,
    TaskNotFound,
    AttachmentNotFound,
    WorkToolRefused,
  ].some((refusal) => error instanceof refusal);
}

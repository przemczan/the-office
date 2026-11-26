import type { OfficeToolRegistry } from "../../../engine/index.js";
import { AttachmentNotFound } from "../../domain/attachment-not-found.js";
import { AttachmentRefused } from "../../domain/attachment-refused.js";
import type { Author, UserRef } from "../../domain/author.js";
import { IdeaNotFound } from "../../domain/idea-not-found.js";
import { IdeaRefused } from "../../domain/idea-refused.js";
import { InitiativeNotFound } from "../../domain/initiative-not-found.js";
import { InitiativeRefused } from "../../domain/initiative-refused.js";
import { TaskNotFound } from "../../domain/task-not-found.js";
import { TaskRefused } from "../../domain/task-refused.js";
import type { SessionPeople } from "../../ports/session-people.js";

export type OfficeToolResult = Awaited<
  ReturnType<Parameters<OfficeToolRegistry["register"]>[0]["run"]>
>;

/** A tool call The Office can't act on, answered to the Agent as an error. */
export class WorkToolRefused extends Error {}

/**
 * Work's refusals answer the Agent in words it can act on; anything else fails the call. Words
 * alone are a successful answer.
 */
export async function answered(
  read: () => Promise<string | OfficeToolResult>,
): Promise<OfficeToolResult> {
  try {
    const answer = await read();
    return typeof answer === "string" ? { text: answer, isError: false } : answer;
  } catch (error) {
    if (isWorkRefusal(error)) return { text: error.message, isError: true };
    throw error;
  }
}

/**
 * The person in the session, as the Author of what an Office tool makes in their name: with the
 * user who asked them and, for a call held for approval, the user who allowed it.
 */
export async function personInSession(
  people: SessionPeople,
  sessionId: string,
  allowedBy?: UserRef,
): Promise<Author> {
  const roleKey = await people.personInSession(sessionId);
  if (roleKey === undefined) {
    throw new WorkToolRefused("The Office doesn't know whose session this is.");
  }
  const askedBy = await people.askedByInSession(sessionId);
  return {
    kind: "person",
    roleKey,
    ...(askedBy && { askedBy }),
    ...(allowedBy && { allowedBy: { userId: allowedBy.userId, name: allowedBy.name } }),
  };
}

function isWorkRefusal(error: unknown): error is Error {
  return [
    IdeaRefused,
    InitiativeRefused,
    TaskRefused,
    AttachmentRefused,
    IdeaNotFound,
    InitiativeNotFound,
    TaskNotFound,
    AttachmentNotFound,
    WorkToolRefused,
  ].some((refusal) => error instanceof refusal);
}

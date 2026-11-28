import type { ActivitySession } from "@the-office/contracts";
import type { Tone } from "../tone-words.ts";
import { spanWords } from "./activity-words.ts";

/** A session's state as its badge says it. */
export interface SessionStateWords {
  readonly label: string;
  readonly tone: Tone;
}

/** "Working", or what the session waits on: "Waiting on you", "Waiting at Gate", "Reply waiting". */
export function sessionStateWords({
  state,
  waitingOn,
  stageName,
}: Pick<ActivitySession, "state" | "waitingOn" | "stageName">): SessionStateWords {
  if (state === "working" || waitingOn === null) return { label: "Working", tone: "info" };
  switch (waitingOn.kind) {
    case "decision":
      return { label: "Waiting on you", tone: "warning" };
    case "consultant":
      return { label: "Waiting on a Consultant", tone: "warning" };
    case "gate":
      return {
        label: stageName ? `Waiting at ${stageName}` : "Waiting at a Gate",
        tone: "warning",
      };
    case "reply":
      return { label: "Reply waiting", tone: "warning" };
  }
}

/** What the session is: its Stage, else its kind ("Consultation", "Planning", "Chat"). */
export function sessionKindWords({
  sessionKind,
  stageName,
}: Pick<ActivitySession, "sessionKind" | "stageName">): string {
  if (stageName) return stageName;
  switch (sessionKind) {
    case "stage":
      return "Stage";
    case "consultation":
      return "Consultation";
    case "thread":
      return "Planning";
    case "chat":
      return "Chat";
    case "gate":
      return "Gate";
  }
}

/** "Working for 12 min", "Waiting for 2h 10 min". */
export function sessionTimeWords(session: ActivitySession, now: Date): string {
  const state = session.state === "working" ? "Working" : "Waiting";
  return `${state} for ${spanWords(now.getTime() - Date.parse(session.since))}`;
}

/** The one-line question a Decision asks, when the session waits on one. */
export function sessionQuestionWords({ waitingOn }: ActivitySession): string | undefined {
  return waitingOn?.question ?? undefined;
}

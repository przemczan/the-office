/**
 * What The Office's log of a Thread holds, which is what the UI shows (spec §2.4): the engine's
 * transcript stays the engine's.
 */
export type Message = MessageFields & MessageDraft;

interface MessageFields {
  readonly id: string;
  readonly threadId: string;
  readonly at: Date;
}

/** A message by its kind and fields alone, before the log gives it its id, Thread and time. */
export type MessageDraft =
  | { readonly kind: "user"; readonly text: string }
  | { readonly kind: "person"; readonly roleKey: string; readonly text: string }
  /** A few lines the person wrote for whoever continues, when The Office asked for them. */
  | { readonly kind: "handover-note"; readonly roleKey: string; readonly text: string }
  | ToolActivity
  | Refusal;

/** Something the person did with a tool, such as reading a file. */
interface ToolActivity {
  readonly kind: "tool-activity";
  readonly roleKey: string;
  /** The engine's name for the tool, or an Office tool's. */
  readonly tool: string;
  /** What it did, in a line, such as the file it read. */
  readonly summary: string;
}

/** A tool call the Office rules or the engine refused, with the reason the person read. */
interface Refusal {
  readonly kind: "refusal";
  readonly roleKey: string;
  readonly tool: string;
  readonly reason: string;
}

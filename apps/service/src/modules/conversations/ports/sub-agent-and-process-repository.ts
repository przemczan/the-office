import type {
  OutputChunk,
  SubAgentMessage,
  SubAgentMessageDraft,
  SubAgentOrProcess,
} from "../domain/sub-agents-and-processes.js";

/** One item, by its session and the call that started it. */
export interface ItemKey {
  readonly sessionId: string;
  readonly callId: string;
}

/**
 * Where a session's Sub-agents and Processes are kept, with a Sub-agent's messages and a Process's
 * output, each numbered in order per item (spec 2.9), and the caps held as they are added.
 */
export abstract class SubAgentAndProcessRepository {
  /** Keeps a new item; one its session already has stays as it is (false). */
  abstract add(item: SubAgentOrProcess): Promise<boolean>;

  abstract find(key: ItemKey): Promise<SubAgentOrProcess | undefined>;

  /**
   * Replaces the item's own fields, never its sequence or what isn't kept; once it ended, the
   * session's earliest ended items past `ENDED_ITEMS_KEPT` go.
   */
  abstract save(item: SubAgentOrProcess): Promise<void>;

  /**
   * Adds a Sub-agent's messages after its last, dropping its earliest past `MESSAGES_KEPT`; the
   * messages with their sequences, or none when no such Sub-agent is kept.
   */
  abstract addMessages(
    key: ItemKey,
    drafts: readonly SubAgentMessageDraft[],
    at: Date,
  ): Promise<readonly SubAgentMessage[]>;

  /**
   * Adds a chunk of a Process's output after its last, dropping its earliest past
   * `OUTPUT_KEPT_BYTES`; the chunk with its sequence, or undefined when no such Process is kept.
   */
  abstract addOutput(key: ItemKey, text: string): Promise<OutputChunk | undefined>;

  /** The session's items in the order they started. */
  abstract ofSession(sessionId: string): Promise<readonly SubAgentOrProcess[]>;

  abstract messagesAfter(key: ItemKey, sequence: number): Promise<readonly SubAgentMessage[]>;

  abstract outputAfter(key: ItemKey, sequence: number): Promise<readonly OutputChunk[]>;

  /** Every item still Running, in any session. */
  abstract running(): Promise<readonly SubAgentOrProcess[]>;

  /** Removes the session's items with their messages and output. */
  abstract removeSession(sessionId: string): Promise<void>;
}

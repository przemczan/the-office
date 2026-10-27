import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";

/** A Handover note a Link card gave the user for a new Thread, and who wrote it, by Role key. */
export interface HandoverNote {
  readonly text: string;
  readonly from: string;
}

/**
 * The Handover notes waiting in new Threads' composers, by Thread id: a Link card leaves one as it
 * opens the Thread, and the composer takes it as its draft. They live only in this page: the user
 * sends the note themselves, or leaves it out, and nothing is kept for them before that.
 */
export interface HandoverNotes {
  leave(threadId: string, note: HandoverNote): void;
  waitingIn(threadId: string): HandoverNote | undefined;
  /** The note was sent or left out. */
  clear(threadId: string): void;
}

const HandoverNotesContext = createContext<HandoverNotes | undefined>(undefined);

export function HandoverNotesProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const notes = useRef(new Map<string, HandoverNote>());
  const value = useMemo<HandoverNotes>(
    () => ({
      leave: (threadId, note) => void notes.current.set(threadId, note),
      waitingIn: (threadId) => notes.current.get(threadId),
      clear: (threadId) => void notes.current.delete(threadId),
    }),
    [],
  );
  return <HandoverNotesContext value={value}>{children}</HandoverNotesContext>;
}

export function useHandoverNotes(): HandoverNotes {
  const notes = useContext(HandoverNotesContext);
  if (notes === undefined) throw new Error("useHandoverNotes needs the shell's provider.");
  return notes;
}

import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";

/**
 * The drafts waiting in Threads' composers, by Thread id: asking someone from a page, such as Devops
 * about a Project's commands, leaves one as it opens the Thread, a composer that comes and goes
 * leaves its own, and the composer takes it as its draft. They live only in this page: the user
 * edits and sends the message themselves.
 */
export interface ThreadDrafts {
  leave(threadId: string, text: string): void;
  waitingIn(threadId: string): string | undefined;
  /** The message was sent. */
  clear(threadId: string): void;
}

const ThreadDraftsContext = createContext<ThreadDrafts | undefined>(undefined);

export function ThreadDraftsProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const drafts = useRef(new Map<string, string>());
  const value = useMemo<ThreadDrafts>(
    () => ({
      leave: (threadId, text) => void drafts.current.set(threadId, text),
      waitingIn: (threadId) => drafts.current.get(threadId),
      clear: (threadId) => void drafts.current.delete(threadId),
    }),
    [],
  );
  return <ThreadDraftsContext value={value}>{children}</ThreadDraftsContext>;
}

export function useThreadDrafts(): ThreadDrafts {
  const drafts = useContext(ThreadDraftsContext);
  if (drafts === undefined) throw new Error("useThreadDrafts needs the shell's provider.");
  return drafts;
}

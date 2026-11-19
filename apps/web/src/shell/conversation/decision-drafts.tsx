import type { Decision } from "@the-office/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { initialDraft, type DecisionDraft, type QuestionDraft } from "./decision-form-words.ts";

/**
 * The Decision forms' drafts, by Decision id, for as long as the page lives: the same Decision on a
 * Task's Needs you, in its window, on Now and in the Needs you panel shows one draft, kept when the
 * window closes or an answer is refused, and cleared once it is sent (the Decision form card's
 * design). A Decision put to a Consultant is taken over the same way: once on the page, wherever
 * its form shows.
 */
interface DecisionDrafts {
  read(decisionId: string): DecisionDraft | undefined;
  write(decisionId: string, draft: DecisionDraft): void;
  clear(decisionId: string): void;
  isTakenOver(decisionId: string): boolean;
  takeOver(decisionId: string): void;
  subscribe(listener: () => void): () => void;
}

const DecisionDraftsContext = createContext<DecisionDrafts | undefined>(undefined);

export function DecisionDraftsProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const drafts = useRef(new Map<string, DecisionDraft>());
  const takenOver = useRef(new Set<string>());
  const listeners = useRef(new Set<() => void>());
  const value = useMemo<DecisionDrafts>(() => {
    const notify = (): void => listeners.current.forEach((listener) => listener());
    return {
      read: (decisionId) => drafts.current.get(decisionId),
      write: (decisionId, draft) => {
        drafts.current.set(decisionId, draft);
        notify();
      },
      clear: (decisionId) => {
        if (drafts.current.delete(decisionId)) notify();
      },
      isTakenOver: (decisionId) => takenOver.current.has(decisionId),
      takeOver: (decisionId) => {
        takenOver.current.add(decisionId);
        notify();
      },
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => void listeners.current.delete(listener);
      },
    };
  }, []);
  return <DecisionDraftsContext value={value}>{children}</DecisionDraftsContext>;
}

/** A Decision's draft, wherever its form shows, and how to change it. */
export interface DecisionDraftHandle {
  readonly draft: DecisionDraft;
  /** Whether the user changed anything yet: a fresh draft is the recommendations, unsaved. */
  readonly kept: boolean;
  update(index: number, change: Partial<QuestionDraft>): void;
  setGeneralComment(generalComment: string): void;
  /** The form was sent. */
  clear(): void;
}

export function useDecisionDraft(
  decision: Pick<Decision, "id" | "questions">,
): DecisionDraftHandle {
  const drafts = useDrafts();
  const { id } = decision;
  const kept = useSyncExternalStore(drafts.subscribe, () => drafts.read(id));
  const fresh = useMemo(() => initialDraft(decision), [decision]);
  const draft = kept ?? fresh;
  const update = useCallback(
    (index: number, change: Partial<QuestionDraft>) => {
      const latest = drafts.read(id) ?? fresh;
      drafts.write(id, {
        ...latest,
        questions: latest.questions.map((question, at) =>
          at === index ? { ...question, ...change } : question,
        ),
      });
    },
    [drafts, id, fresh],
  );
  const setGeneralComment = useCallback(
    (generalComment: string) => drafts.write(id, { ...(drafts.read(id) ?? fresh), generalComment }),
    [drafts, id, fresh],
  );
  const clear = useCallback(() => drafts.clear(id), [drafts, id]);
  return { draft, kept: kept !== undefined, update, setGeneralComment, clear };
}

/**
 * Whether the user took over a Decision put to a Consultant (spec §2.4): its form stays locked until
 * they press Take it over, so a stray click answers nothing. Taking over only unlocks the form; the
 * answer still takes the Decision from the Consultant. One the user answers is never locked.
 */
export function useTakeOver(decision: Pick<Decision, "id" | "putTo">): {
  readonly locked: boolean;
  takeOver(): void;
} {
  const drafts = useDrafts();
  const { id } = decision;
  const takenOver = useSyncExternalStore(drafts.subscribe, () => drafts.isTakenOver(id));
  const takeOver = useCallback(() => drafts.takeOver(id), [drafts, id]);
  return { locked: decision.putTo !== null && !takenOver, takeOver };
}

function useDrafts(): DecisionDrafts {
  const drafts = useContext(DecisionDraftsContext);
  if (drafts === undefined) throw new Error("A Decision's form needs the shell's provider.");
  return drafts;
}

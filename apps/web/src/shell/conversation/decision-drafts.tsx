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
 * design).
 */
interface DecisionDrafts {
  read(decisionId: string): DecisionDraft | undefined;
  write(decisionId: string, draft: DecisionDraft): void;
  clear(decisionId: string): void;
  subscribe(listener: () => void): () => void;
}

const DecisionDraftsContext = createContext<DecisionDrafts | undefined>(undefined);

export function DecisionDraftsProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const drafts = useRef(new Map<string, DecisionDraft>());
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
  const drafts = useContext(DecisionDraftsContext);
  if (drafts === undefined) throw new Error("useDecisionDraft needs the shell's provider.");
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

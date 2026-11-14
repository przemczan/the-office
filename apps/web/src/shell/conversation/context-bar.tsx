import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ContextOverride, Thread } from "@the-office/contracts";
import { SegmentedControl } from "@the-office/ui";
import { useEffect, type ReactNode } from "react";
import { chooseContextOverride, threadQueries } from "../../api/conversations.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { TokenCount } from "../token-count.tsx";
import { useCacheState } from "./cache-mark.tsx";
import {
  CONTEXT_CHOICES,
  contextChoiceOf,
  contextBarLabel,
  contextChoiceWords,
  offersAChoice,
  overrideOf,
  startsASessionWords,
  type CacheState,
  type ContextChoice,
} from "./context-words.ts";

/**
 * Under the composer (spec §2.5): what the next message does to the Thread's session and what it
 * costs, the Thread's tokens, and Auto, Continue and Start fresh, each saying the same of itself.
 */
export function ContextBar({
  thread,
  personName,
}: {
  readonly thread: Thread;
  readonly personName: string;
}): ReactNode {
  const queryClient = useQueryClient();
  const choosing = useMutation({
    mutationFn: (override: ContextOverride | null) => chooseContextOverride(thread.id, override),
    onSuccess: (chosen) => queryClient.setQueryData(threadQueries.one(chosen.id).queryKey, chosen),
  });
  const { context } = thread;
  const cache = useCacheState(context);
  // The service's move was read while the cache was warm: what it does now is read again.
  const cooled = cache.kind === "cold" && context.cacheWarmUntil !== null;
  useEffect(() => {
    if (cooled) void queryClient.invalidateQueries(threadQueries.one(thread.id));
  }, [cooled, queryClient, thread.id]);
  const chosen = contextChoiceOf(context.override);
  const wordsOf = (choice: ContextChoice): string =>
    contextChoiceWords(context, choice, cache, personName);
  return (
    <div className="context-bar">
      <div className="context-choice">
        {offersAChoice(context) && (
          <SegmentedControl
            size="sm"
            value={chosen}
            options={CONTEXT_CHOICES.map(({ value, label }) => ({
              value,
              label,
              title: wordsOf(value),
            }))}
            onChange={(value) => choosing.mutate(overrideOf(value as ContextChoice))}
          />
        )}
        <span className="context-label" aria-label="Context">
          {offersAChoice(context) ? wordsOf(chosen) : noChoiceWords(thread, cache, personName)}
        </span>
      </div>
      <span className="context-tokens">
        <TokenCount tokens={thread.tokens} label="tokens in this Thread" />
      </span>
      {choosing.error && <RefusalAlert title="That didn't change" error={choosing.error} />}
    </div>
  );
}

/** A Thread with no session to choose about says what the next message starts. */
function noChoiceWords({ context }: Thread, cache: CacheState, personName: string): string {
  return cache.kind === "none" && context.reason === "new-thread" && context.briefTokens !== null
    ? startsASessionWords(context.briefTokens)
    : contextBarLabel(context, personName);
}

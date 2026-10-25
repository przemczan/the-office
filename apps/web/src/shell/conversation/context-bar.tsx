import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ContextOverride, Thread } from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { chooseContextOverride, threadQueries } from "../../api/conversations.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import {
  contextDetail,
  MOVE_WORDS,
  OVERRIDE_HINTS,
  OVERRIDE_WORDS,
  tokensShort,
} from "./context-words.ts";

/**
 * The Thread's context label (spec §2.5): what the next message does to its session and why, the
 * Thread's tokens, and what the user may choose instead, with its estimated cost.
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
  const { context, tokens } = thread;
  const total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation;
  return (
    <div className="context-bar">
      <div className="context-label" aria-label="Context">
        <span className={`context-pill ${context.move}`}>
          <Icon name={context.move === "resume" ? "zap" : "sparkles"} size={12} />
          {MOVE_WORDS[context.move]}
        </span>
        {/* The pill shows the break; the label still reads whole, as the log's lines do. */}
        <span className="visually-hidden"> · </span>
        <span>{contextDetail(context, personName)}</span>
      </div>
      <span className="context-tokens">{tokensShort(total)} tokens in this Thread</span>
      <span className="context-actions">
        {context.alternatives.map(({ override, tokens: cost }) => (
          <Button
            key={override}
            size="sm"
            variant="secondary"
            title={OVERRIDE_HINTS[override]}
            loading={choosing.isPending && choosing.variables === override}
            onClick={() => choosing.mutate(override)}
          >
            {OVERRIDE_WORDS[override]} · ~{tokensShort(cost)}
          </Button>
        ))}
        {context.override !== null && (
          <Button
            size="sm"
            variant="ghost"
            title="Back to the Context policy's choice"
            onClick={() => choosing.mutate(null)}
          >
            Auto
          </Button>
        )}
      </span>
      {choosing.error && <RefusalAlert title="That didn't change" error={choosing.error} />}
    </div>
  );
}

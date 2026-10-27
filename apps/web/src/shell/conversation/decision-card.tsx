import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { Decision, DecisionAnswer, Thread } from "@the-office/contracts";
import { Badge, Button, Icon, Textarea } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { answerDecision, decisionQueries, threadQueries } from "../../api/conversations.ts";
import { MarkdownText } from "../markdown-text.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import "./conversation.css";

/**
 * A Decision as a card in the asking person's Thread (spec §2.4): the question, what they found,
 * the options with the one they recommend, and a free answer. Follow-ups are ordinary messages in
 * the composer below, and leave it open, except in a Stage Thread, where The Office sends the
 * messages once no Stage runs. Nothing is answered while the person is still answering.
 * The Office's own Decisions about the Task's Pipeline show in the same Thread, as The Office's.
 */
export function DecisionCard({
  decision,
  personName,
  answering,
  followUps,
}: {
  readonly decision: Decision;
  readonly personName: string;
  readonly answering: boolean;
  /** The user can ask the person something first in the composer below. */
  readonly followUps: boolean;
}): ReactNode {
  const asker = askerName(decision, personName);
  return (
    <section className="message decision-card" aria-label={`Decision: ${decision.question}`}>
      <div className="message-by">
        <Badge tone="warning">Decision</Badge>
        {asker}
      </div>
      <div className="message-text decision-question">
        <MarkdownText text={decision.question} />
      </div>
      {decision.context !== "" && (
        <div className="decision-context">
          <MarkdownText text={decision.context} />
        </div>
      )}
      {decision.answer === null ? (
        <OpenDecision
          decision={decision}
          personName={personName}
          answering={answering}
          followUps={followUps}
        />
      ) : (
        <div className="decision-answered">
          <Icon name="check" size={12} />
          Answered
        </div>
      )}
    </section>
  );
}

function OpenDecision({
  decision,
  personName,
  answering,
  followUps,
}: {
  readonly decision: Decision;
  readonly personName: string;
  readonly answering: boolean;
  readonly followUps: boolean;
}): ReactNode {
  const [freeAnswer, setFreeAnswer] = useState("");
  const answeringDecision = useAnswering(decision);
  const busy = answering || answeringDecision.isPending;
  const recommended = decision.recommendation.option;
  const byTheOffice = decision.roleKey === null;
  const waitHint = answering ? `${personName} is still answering` : undefined;
  return (
    <>
      <div className="decision-options" role="group" aria-label="Options">
        {decision.options.map((option, index) => (
          <Button
            key={option}
            size="sm"
            variant={index === recommended ? "primary" : "secondary"}
            disabled={busy}
            title={waitHint}
            onClick={() => answeringDecision.mutate({ kind: "option", option: index })}
          >
            {option}
          </Button>
        ))}
      </div>
      <p className="decision-recommendation">
        {askerName(decision, personName)} recommends “{decision.options[recommended]}”:{" "}
        <MarkdownText text={decision.recommendation.reason} inline />
      </p>
      <form
        className="decision-free-answer"
        onSubmit={(event) => {
          event.preventDefault();
          answeringDecision.mutate(
            { kind: "free-answer", text: freeAnswer },
            { onSuccess: () => setFreeAnswer("") },
          );
        }}
      >
        <Textarea
          aria-label="Your answer"
          rows={2}
          placeholder="Or answer in your own words…"
          value={freeAnswer}
          onChange={(event) => setFreeAnswer(event.target.value)}
        />
        <Button
          size="sm"
          variant="secondary"
          type="submit"
          disabled={busy || freeAnswer.trim() === ""}
          title={waitHint}
        >
          Answer
        </Button>
      </form>
      {followUps && !byTheOffice && (
        <p className="decision-hint">
          A question first? Ask {personName} below; the Decision stays open.
        </p>
      )}
      {answeringDecision.error && (
        <RefusalAlert title="The answer wasn't sent" error={answeringDecision.error} />
      )}
    </>
  );
}

/** Who asked: the Thread's person, or The Office, which has no person (spec §9). */
function askerName(decision: Decision, personName: string): string {
  return decision.roleKey === null ? "The Office" : personName;
}

/** Answers the Decision; the asking person takes it in the Thread, which answers with its state. */
function useAnswering(decision: Decision): UseMutationResult<Thread, Error, DecisionAnswer> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (answer: DecisionAnswer) => answerDecision(decision.id, answer),
    onSuccess: async (thread) => {
      queryClient.setQueryData(threadQueries.one(thread.id).queryKey, thread);
      await Promise.all([
        queryClient.invalidateQueries(threadQueries.messages(thread.id)),
        queryClient.invalidateQueries(decisionQueries.open()),
      ]);
    },
  });
}

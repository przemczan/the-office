import { Button } from "@the-office/ui";
import type { ReactNode } from "react";
import { MarkdownText } from "../markdown-text.tsx";
import {
  AnswerRefused,
  AnsweringHints,
  askerName,
  ConsultationNote,
  DecisionDetail,
  FollowUpsHint,
  stillAnsweringHint,
  useAnswering,
  type DecisionAnsweringProps,
} from "./decision-parts.tsx";

/**
 * The approval of a call past a Hard switch (spec §2.4): a card of its own, never a question of a
 * form. Each option, Allow once or Deny, is sent in one click, with no comment and no Ask me again.
 */
export function ApprovalCard({
  decision,
  personName,
  answering,
  reachesAtTurnEnd = false,
  followUps,
}: DecisionAnsweringProps): ReactNode {
  const sending = useAnswering(decision);
  const asker = askerName(decision, personName);
  const waitHint = stillAnsweringHint(answering, asker);
  const question = decision.questions[0];
  if (question?.kind !== "choice") return null;
  const recommended = question.recommendation.option;
  return (
    <>
      <div className="message-text decision-question">
        <MarkdownText text={question.question} />
      </div>
      <DecisionDetail decision={decision} />
      <ConsultationNote decision={decision} />
      <p className="decision-recommendation">
        {asker} recommends “{question.options[recommended]}”:{" "}
        <MarkdownText text={question.recommendation.reason} inline />
      </p>
      <div className="decision-actions" role="group" aria-label="Options">
        {question.options.map((option, index) => (
          <Button
            key={option}
            variant={index === recommended ? "primary" : "secondary"}
            disabled={answering || sending.isPending}
            title={waitHint}
            onClick={() =>
              sending.mutate({ kind: "submitted", answers: [{ kind: "option", option: index }] })
            }
          >
            {option}
          </Button>
        ))}
      </div>
      {sending.error && <AnswerRefused error={sending.error} />}
      <AnsweringHints
        personName={asker}
        answering={answering}
        reachesAtTurnEnd={reachesAtTurnEnd}
      />
      <FollowUpsHint decision={decision} personName={personName} followUps={followUps} />
    </>
  );
}

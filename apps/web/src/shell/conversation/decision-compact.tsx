import { Badge, Button, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { MarkdownText } from "../markdown-text.tsx";
import { useDecisionDraft, useTakeOver } from "./decision-drafts.tsx";
import { DismissButton, DismissStep, ProgressLine, useDismissal } from "./decision-form.tsx";
import {
  acceptAnswer,
  allChoices,
  draftChanges,
  draftKeptWords,
  moreQuestionsWords,
} from "./decision-form-words.ts";
import {
  AnswerRefused,
  AnsweringHints,
  askerName,
  ConsultationNote,
  ContextFirstLine,
  FollowUpsHint,
  stillAnsweringHint,
  TAKE_IT_OVER_FIRST,
  useAnswering,
  useNamedAttachments,
  type DecisionAnsweringProps,
} from "./decision-parts.tsx";
import { DecisionWindow } from "./decision-window.tsx";

/**
 * A long form, or one with Attachments, in brief (the Decision form card's design): the context's
 * first line, question 1 with its recommendation, how many more, the progress line, Accept while
 * every question is a choice and the draft is the recommendations, Open details, the window the
 * form is answered in, and Dismiss where the user can close it unanswered.
 */
export function CompactDecision({
  decision,
  personName,
  answering,
  reachesAtTurnEnd = false,
  followUps,
}: DecisionAnsweringProps): ReactNode {
  const attachments = useNamedAttachments(decision);
  const handle = useDecisionDraft(decision);
  const { draft, clear } = handle;
  const accepting = useAnswering(decision, clear);
  const { locked } = useTakeOver(decision);
  const [windowAt, setWindowAt] = useState<number | undefined>(undefined);
  const asker = askerName(decision, personName);
  const dismissal = useDismissal({ decision, asker, handle, sending: accepting });
  const waitHint =
    stillAnsweringHint(answering, asker) ?? (locked ? TAKE_IT_OVER_FIRST : undefined);
  const changes = draftChanges(decision, draft);
  const canAccept = allChoices(decision) && changes === 0;
  const first = decision.questions[0];
  const count = decision.questions.length;
  const more = moreQuestionsWords(decision);
  const attached = attachments?.length ?? 0;
  const notes = [
    ...(more === undefined ? [] : [more]),
    ...(attached === 0
      ? []
      : [`${attached} Attachment${attached === 1 ? "" : "s"} to look at in Open details`]),
  ];
  return (
    <div className="decision-compact">
      <ContextFirstLine decision={decision} />
      <ConsultationNote decision={decision} />
      {first && decision.kind !== "request" && (
        <section className="decision-compact-first" aria-label="Question 1">
          <p className="decision-overline">
            {count > 1 ? `Question 1 of ${count}` : "The question"}
          </p>
          <p className="decision-compact-question">
            <MarkdownText text={first.question} inline />
          </p>
          {first.kind === "choice" ? (
            <>
              <p className="decision-compact-recommended">
                <Icon name="check" size={14} />
                {first.options[first.recommendation.option]}
                <Badge tone="accent" size="sm">
                  Recommended
                </Badge>
              </p>
              <p className="decision-recommendation">
                {asker} recommends it: <MarkdownText text={first.recommendation.reason} inline />
              </p>
            </>
          ) : (
            <p className="decision-recommendation">Answered in words.</p>
          )}
        </section>
      )}
      {notes.length > 0 && <p className="decision-compact-more">{notes.join(" · ")}</p>}
      {dismissal.open ? (
        <DismissStep dismissal={dismissal} />
      ) : (
        <>
          {accepting.error && <AnswerRefused error={accepting.error} />}
          <div className="decision-actions">
            {canAccept && (
              <Button
                iconLeft={<Icon name="check" size={13} />}
                disabled={answering || locked || accepting.isPending}
                title={waitHint}
                onClick={() => accepting.mutate(acceptAnswer(decision))}
              >
                Accept
              </Button>
            )}
            <Button
              variant={canAccept ? "secondary" : "primary"}
              disabled={attachments === undefined}
              title={attachments === undefined ? "Reading the Attachments…" : undefined}
              onClick={() => setWindowAt(0)}
            >
              Open details
            </Button>
            {dismissal.can && <DismissButton dismissal={dismissal} />}
            {changes > 0 && <Badge tone="info">{draftKeptWords(changes)}</Badge>}
            {count > 1 && <ProgressLine decision={decision} draft={draft} onJump={setWindowAt} />}
          </div>
        </>
      )}
      <AnsweringHints
        personName={asker}
        answering={answering}
        reachesAtTurnEnd={reachesAtTurnEnd}
      />
      <FollowUpsHint decision={decision} personName={personName} followUps={followUps} />
      {windowAt !== undefined && attachments !== undefined && (
        <DecisionWindow
          decision={decision}
          personName={personName}
          answering={answering}
          reachesAtTurnEnd={reachesAtTurnEnd}
          followUps={followUps}
          attachments={attachments}
          firstQuestion={windowAt}
          onClose={() => setWindowAt(undefined)}
        />
      )}
    </div>
  );
}

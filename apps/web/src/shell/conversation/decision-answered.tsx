import { useQuery } from "@tanstack/react-query";
import type { Decision } from "@the-office/contracts";
import { Icon, TextButton } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { roleQueries } from "../../api/people.ts";
import { MarkdownText } from "../markdown-text.tsx";
import { roleFirstName } from "../person-name.ts";
import { userName, useSignedInUserId } from "../use-user-name.ts";
import { answeredLines, type AnsweredLine } from "./decision-form-words.ts";
import {
  ClosedLine,
  consultantName,
  ContextFirstLine,
  useConsultationId,
} from "./decision-parts.tsx";
import { atUsersRequestWords } from "./decision-words.ts";
import { ThreadLink } from "./thread-link.tsx";

/** Past this many questions a sent form shows the first ones and Show all. */
const SHOWN_AT_FIRST = 3;

/**
 * A Decision once nothing waits on it, read-only where it was asked (the Decision form card's
 * design): each question with its answer and comment, the general comment, and who answered;
 * asked again, the questions unanswered and the general comment; closed, that its Task was dropped.
 */
export function DecisionAnswered({ decision }: { readonly decision: Decision }): ReactNode {
  const [showingAll, setShowingAll] = useState(false);
  const { formAnswer, questions } = decision;
  const submitted = formAnswer?.kind === "submitted" ? formAnswer : undefined;
  const lines: readonly (AnsweredLine | UnansweredLine)[] = submitted
    ? answeredLines(decision, submitted)
    : questions.map((question, index) => ({
        number: index + 1,
        question: question.question,
        unanswered: true as const,
      }));
  // A request's one question is the card's "Asked you to" line already, so unanswered it shows none.
  const listed = decision.kind === "request" && !submitted ? [] : lines;
  const shown = showingAll ? listed : listed.slice(0, SHOWN_AT_FIRST);
  const numbered = questions.length > 1;
  const general = formAnswer?.generalComment?.trim();
  return (
    <div className="decision-settled">
      <ContextFirstLine decision={decision} />
      {shown.length > 0 && (
        <ol className="decision-answers">
          {shown.map((line) => (
            <li key={line.number} className="decision-answer">
              {numbered && <span className="decision-form-number answered">{line.number}</span>}
              <p className="decision-answer-question">
                <MarkdownText text={line.question} inline />
              </p>
              {"unanswered" in line ? (
                <p className="decision-answer-words unanswered">Not answered</p>
              ) : (
                <>
                  <p className="decision-answer-words">
                    {line.answer}
                    {line.recommended && (
                      <span className="decision-answer-tag"> (recommended)</span>
                    )}
                  </p>
                  {line.comment !== undefined && (
                    <p className="decision-answer-comment">
                      <strong>Comment:</strong> {line.comment}
                    </p>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      {!showingAll && listed.length > SHOWN_AT_FIRST && (
        <TextButton className="decision-show-all" onClick={() => setShowingAll(true)}>
          <Icon name="chevron-down" size={12} /> Show all {listed.length}
        </TextButton>
      )}
      {submitted && general && (
        <p className="decision-answer-comment decision-general-comment">
          <strong>General comment:</strong> {general}
        </p>
      )}
      <Outcome decision={decision} />
    </div>
  );
}

interface UnansweredLine {
  readonly number: number;
  readonly question: string;
  readonly unanswered: true;
}

/** What became of it: who answered, asked again with the general comment, or closed. */
function Outcome({ decision }: { readonly decision: Decision }): ReactNode {
  const signedInUserId = useSignedInUserId();
  const { formAnswer } = decision;
  if (decision.closedAt !== null) return <ClosedLine />;
  if (formAnswer === null) return null;
  const general = formAnswer.generalComment?.trim();
  if (decision.answeredByTheOffice) {
    return (
      <p className="decision-answered">
        <Icon name="check" size={12} />
        <span>
          Answered by The Office{general ? ": " : ""}
          {general && <MarkdownText text={general} inline />}
        </span>
      </p>
    );
  }
  if (formAnswer.kind === "asked-again") {
    const who =
      decision.answeredByUser === null
        ? "Asked again"
        : `Asked again by ${userName(decision.answeredByUser, signedInUserId, "you")}`;
    return (
      <p className="decision-answered decision-asked-again">
        <Icon name="rotate-ccw" size={12} />
        <span>
          {who}
          {general ? (
            <>
              : <span className="decision-outcome-words">{general}</span>
            </>
          ) : (
            ", with no comment"
          )}
        </span>
      </p>
    );
  }
  return (
    <p className="decision-answered">
      <Icon name="check" size={12} />
      <span>
        <AnsweredBy decision={decision} />
      </span>
    </p>
  );
}

/**
 * Who answered: the user, another user, the Consultant in a Consultation, or a person the user
 * asked to answer it for them, with the way to the Thread they asked in.
 */
function AnsweredBy({ decision }: { readonly decision: Decision }): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  const signedInUserId = useSignedInUserId();
  const { atUsersRequest, answeredBy, answeredByUser } = decision;
  const consultationId = useConsultationId(decision, answeredBy);
  if (atUsersRequest !== null) {
    return (
      <>
        Answered by {roleFirstName(atUsersRequest.roleKey, roles)}{" "}
        <ThreadLink threadId={atUsersRequest.threadId}>
          {atUsersRequestWords(atUsersRequest.user, signedInUserId)}
        </ThreadLink>
      </>
    );
  }
  if (answeredBy !== null) {
    return (
      <>
        Answered by {consultantName(answeredBy, roles)} in a Consultation
        {consultationId !== undefined && (
          <>
            {" · "}
            <ThreadLink threadId={consultationId}>Open the Consultation</ThreadLink>
          </>
        )}
      </>
    );
  }
  return answeredByUser === null
    ? "Answered"
    : `Answered by ${userName(answeredByUser, signedInUserId, "you")}`;
}

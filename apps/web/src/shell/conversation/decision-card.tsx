import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Decision } from "@the-office/contracts";
import { createContext, useContext, type ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { RecordMention } from "../record-mention.tsx";
import { ApprovalCard } from "./approval-card.tsx";
import { DecisionAnswered } from "./decision-answered.tsx";
import { CompactDecision } from "./decision-compact.tsx";
import { DecisionForm } from "./decision-form.tsx";
import { decisionSummary, isCompact } from "./decision-form-words.ts";
import {
  bringDecisionCardIntoView,
  consultantName,
  decisionCardElementId,
  DecisionFrame,
  LinkToConsultation,
  type DecisionAnsweringProps,
} from "./decision-parts.tsx";
import "./conversation.css";

/** Where the card shows, which decides whether a long form is shown compact. */
export type DecisionCardPlace = "needs-you" | "thread" | "inline";

/** What every form of an open Decision the user answers is given. */
export interface DecisionCardProps extends DecisionAnsweringProps {
  /** Where or when it was asked, in the card's first line. */
  readonly place?: ReactNode;
  /** The card a link to the Decision lands on: the page's, not the panel's open over it. */
  readonly landing?: boolean;
  /**
   * Where the card shows: a Task's Needs you (and Now and the Needs you panel), a Thread that
   * answers it in place, or inline in a chat, which is always the whole form in place. In the
   * first two a long form, or one with Attachments, is the compact card.
   */
  readonly where?: DecisionCardPlace;
}

/**
 * A Decision where the user answers it (spec §2.4, the Decision form card's design): the form, in
 * place or compact; the approval of a call, one click per option; or, once nothing waits on it,
 * what became of it. The Office's own Decisions about the Task's Pipeline show the same way, as
 * The Office's.
 */
export function DecisionCard({
  place,
  landing = false,
  where = "needs-you",
  ...answering
}: DecisionCardProps): ReactNode {
  const { decision } = answering;
  const settled = decision.closedAt !== null || decision.formAnswer !== null;
  return (
    <DecisionFrame
      decision={decision}
      personName={answering.personName}
      label={`Decision: ${decisionSummary(decision)}`}
      elementId={landing ? decisionCardElementId(decision.id) : undefined}
      place={place}
      settled={settled}
    >
      {settled ? (
        <DecisionAnswered decision={decision} />
      ) : decision.kind === "approval" ? (
        <ApprovalCard {...answering} />
      ) : where !== "inline" && isCompact(decision) ? (
        <CompactDecision {...answering} />
      ) : (
        <DecisionForm
          {...answering}
          layout="in-place"
          {...(where === "inline" ? { followUpsWhere: "below" } : {})}
        />
      )}
    </DecisionFrame>
  );
}

/**
 * A Decision in its Thread: while open a short form with the way to its card, in the Task's Needs
 * you, then what became of it, whole. In an Initiative's planning Thread, where the Planner asks
 * about any of its Tasks, each names the Task it is on. One put to a Consultant links to their
 * Consultation; a call made from a chat has no Needs you, its Consultation in the callee's chat
 * (spec §2.4).
 */
export function DecisionInThread({
  decision,
  personName,
}: {
  readonly decision: Decision;
  readonly personName: string;
}): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  const home = useQuery(threadQueries.one(decision.threadId)).data?.home;
  const settled = decision.closedAt !== null || decision.formAnswer !== null;
  const count = decision.questions.length;
  return (
    <DecisionFrame
      decision={decision}
      personName={personName}
      label={`Decision: ${decisionSummary(decision)}`}
      settled={settled}
    >
      {home?.kind === "initiative" && decision.taskId !== null && (
        <p className="decision-on-task">
          On <RecordMention link={{ kind: "task", taskId: decision.taskId }} written="its Task" />
        </p>
      )}
      {settled ? (
        <DecisionAnswered decision={decision} />
      ) : (
        <>
          {decision.kind !== "request" && (
            <p className="message-text decision-question">
              {count > 1 && `${count} questions, starting with: `}
              {decision.questions[0]?.question}
            </p>
          )}
          <p className="decision-hint">
            {decision.putTo === null
              ? "Waits on you."
              : `Waiting on ${consultantName(decision.putTo, roles)} in a Consultation.`}{" "}
            {decision.taskId !== null && (
              <LinkToDecisionCard
                decision={decision}
                taskId={decision.taskId}
                inInitiative={home?.kind === "initiative"}
              />
            )}
            {decision.putTo !== null && (
              <>
                {" "}
                <LinkToConsultation decision={decision} consultantKey={decision.putTo} />
              </>
            )}
          </p>
        </>
      )}
    </DecisionFrame>
  );
}

/** What the page does as a link leaves for the card, such as clearing what lies over it. */
export const DecisionCardLinkContext = createContext<() => void>(() => undefined);

/**
 * The way from a Thread to the card, keeping what the Task's page has open. From an Initiative's
 * planning Thread, which isn't one of the Task's, it opens the Task's page at the card alone.
 */
function LinkToDecisionCard({
  decision,
  taskId,
  inInitiative,
}: {
  readonly decision: Decision;
  readonly taskId: string;
  readonly inInitiative: boolean;
}): ReactNode {
  const clearTheWay = useContext(DecisionCardLinkContext);
  return (
    <Link
      to="/tasks/$taskId"
      params={{ taskId }}
      search={(shown) =>
        inInitiative
          ? { decision: decision.id }
          : { ...shown, taskThread: decision.threadId, decision: decision.id }
      }
      onClick={() => {
        clearTheWay();
        bringDecisionCardIntoView(decision.id);
      }}
    >
      {decision.putTo === null ? "Answer it in Needs you" : "Take it over in Needs you"}
    </Link>
  );
}

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
  useDecisionThread,
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
  /** A line under the card's first, such as what in an Initiative it is on. */
  readonly lead?: ReactNode;
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
  lead,
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
      {lead}
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
 * you, then what became of it, whole. In an Initiative's shaping or planning Thread, where the
 * person asks about any of its Tasks, each names the Task it is on; one on no Task, about the
 * Initiative as a whole, is answered in the Thread itself, the whole card in place. One put to a
 * Consultant links to their Consultation; a call made from a chat has no Needs you, its
 * Consultation in the callee's chat (spec §2.4). One waiting on the user in a person's chat, never
 * under Needs you, is the whole form inline, answered there; its answer reaches the person as their
 * next message.
 */
export function DecisionInThread({
  decision,
  personName,
  answering,
}: {
  readonly decision: Decision;
  readonly personName: string;
  /** The Thread's person is answering, so the form inline in a chat waits. */
  readonly answering: boolean;
}): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  const thread = useQuery(threadQueries.one(decision.threadId)).data;
  const home = thread?.home;
  const settled = decision.closedAt !== null || decision.formAnswer !== null;
  const count = decision.questions.length;
  const onTheInitiative = home?.kind === "initiative" && decision.taskId === null;
  if (onTheInitiative && !settled && decision.putTo === null) {
    return <DecisionOnTheInitiative decision={decision} />;
  }
  if (home?.kind === "chat" && !thread?.consultation && decision.putTo === null) {
    return (
      <DecisionCard
        decision={decision}
        personName={personName}
        answering={answering}
        followUps
        where="inline"
      />
    );
  }
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
      {onTheInitiative && <OnNoTaskLine />}
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

/**
 * An open Decision on no Task in an Initiative's Thread, answered where it is: the form in place,
 * or the compact card past the threshold, as in Needs you; the card a link to it lands on.
 */
function DecisionOnTheInitiative({ decision }: { readonly decision: Decision }): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  const { card } = useDecisionThread(decision, roles);
  return (
    <DecisionCard decision={decision} {...card} where="thread" landing lead={<OnNoTaskLine />} />
  );
}

function OnNoTaskLine(): ReactNode {
  return <p className="decision-on-task">On no Task: about the Initiative as a whole</p>;
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

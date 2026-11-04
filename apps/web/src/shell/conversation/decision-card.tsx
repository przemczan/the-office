import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import type { Attachment, Decision, DecisionAnswer, Role, Thread } from "@the-office/contracts";
import { Badge, Button, Icon, IconButton } from "@the-office/ui";
import { createContext, useContext, useState, type ReactNode } from "react";
import { answerDecision, decisionQueries, threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { attachmentQueries } from "../../api/work.ts";
import { CardAttachments, CardColumns } from "../attachments/card-attachments.tsx";
import { useCopyRecordLink } from "../copy-record-link.ts";
import { MarkdownText } from "../markdown-text.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import { answerWords, namedAttachments } from "./decision-words.ts";
import { MessageField } from "./message-field.tsx";
import "./conversation.css";

/**
 * An open Decision whole (spec §2.4): the question, what they found, the options with the one
 * recommended, a free answer, and the Attachments it names beside them. It shows where the user answers it: on Now, in the Needs you
 * panel and in the Task's Needs you card. Follow-ups are ordinary messages in its Thread, and leave
 * it open, except in a Stage Thread, where The Office sends the messages once no Stage runs.
 * Nothing is answered while the person is still answering. The Office's own Decisions about the
 * Task's Pipeline show the same way, as The Office's.
 */
export function DecisionCard({
  decision,
  personName,
  answering,
  followUps,
  place,
  landing = false,
}: {
  readonly decision: Decision;
  readonly personName: string;
  readonly answering: boolean;
  /** The user can ask the person something first in the Thread. */
  readonly followUps: boolean;
  /** Where it was asked, when the card shows beside its Thread on the Task's page. */
  readonly place?: ReactNode;
  /** The card a link to the Decision lands on: the page's, not the panel's open over it. */
  readonly landing?: boolean;
}): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  const attachments = useNamedAttachments(decision);
  return (
    <DecisionFrame
      decision={decision}
      personName={personName}
      elementId={landing ? decisionCardElementId(decision.id) : undefined}
      place={place}
      side={
        attachments.length > 0 && <CardAttachments title="Attachments" attachments={attachments} />
      }
    >
      <DecisionDetail decision={decision} roles={roles} />
      <OpenDecision
        decision={decision}
        personName={personName}
        answering={answering}
        followUps={followUps}
        consultantName={decision.putTo === null ? undefined : consultantName(decision.putTo, roles)}
      />
    </DecisionFrame>
  );
}

function useNamedAttachments(decision: Decision): readonly Attachment[] {
  const { data } = useQuery({
    ...attachmentQueries.of({ kind: "task", taskId: decision.taskId }),
    enabled: decision.attachmentIds.length > 0,
  });
  return namedAttachments(decision, data ?? []);
}

/**
 * A Decision in its Thread: while open a short form with the way to its card, in the Task's Needs
 * you, then its answered form.
 */
export function DecisionInThread({
  decision,
  personName,
}: {
  readonly decision: Decision;
  readonly personName: string;
}): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  return (
    <DecisionFrame decision={decision} personName={personName}>
      {decision.answer === null ? (
        <p className="decision-hint">
          {decision.putTo === null
            ? "Waits on you."
            : `Waiting on ${consultantName(decision.putTo, roles)} in a Consultation.`}{" "}
          <LinkToDecisionCard decision={decision} />
        </p>
      ) : (
        <>
          <DecisionDetail decision={decision} roles={roles} />
          <div className="decision-answered">
            <Icon name="check" size={12} />
            <span>
              {decision.answeredBy === null
                ? "Answered: "
                : `Answered by ${consultantName(decision.answeredBy, roles)}: `}
              <MarkdownText text={answerWords(decision.answer, decision)} inline />
            </span>
          </div>
        </>
      )}
    </DecisionFrame>
  );
}

/**
 * Brings the Decision's whole card into view, if the page shows it. The address alone can't: a
 * link followed again leaves it as it was.
 */
export function bringDecisionCardIntoView(decisionId: string): void {
  document.getElementById(decisionCardElementId(decisionId))?.scrollIntoView({ block: "start" });
}

function decisionCardElementId(decisionId: string): string {
  return `decision-card-${decisionId}`;
}

/** What the page does as a link leaves for the card, such as clearing what lies over it. */
export const DecisionCardLinkContext = createContext<() => void>(() => undefined);

/** The way from a Thread to the card, keeping what the Task's page has open. */
function LinkToDecisionCard({ decision }: { readonly decision: Decision }): ReactNode {
  const clearTheWay = useContext(DecisionCardLinkContext);
  return (
    <Link
      to="/tasks/$taskId"
      params={{ taskId: decision.taskId }}
      search={(shown) => ({ ...shown, taskThread: decision.threadId, decision: decision.id })}
      onClick={() => {
        clearTheWay();
        bringDecisionCardIntoView(decision.id);
      }}
    >
      {decision.putTo === null ? "Answer it in Needs you" : "Take it over in Needs you"}
    </Link>
  );
}

/**
 * What every form of a Decision has: who asked, the question, and its link, which mentions it in a
 * chat and opens the Task's page at it, marked.
 */
function DecisionFrame({
  decision,
  personName,
  elementId,
  place,
  side,
  children,
}: {
  readonly decision: Decision;
  readonly personName: string;
  readonly elementId?: string | undefined;
  readonly place?: ReactNode;
  /** What to look at beside the Decision. */
  readonly side?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const copyLink = useCopyRecordLink();
  const linkedTo = useSearch({ strict: false }).decision === decision.id;
  return (
    <section
      id={elementId}
      className={`message decision-card${linkedTo ? " linked-to" : ""}`}
      aria-label={`Decision: ${decision.question}`}
      aria-current={linkedTo || undefined}
    >
      <CardColumns side={side}>
        <div className="message-by">
          <Badge tone="warning">Decision</Badge>
          {askerName(decision, personName)}
          {place}
          <IconButton
            className="decision-copy-link"
            icon={<Icon name="link" size={12} />}
            label="Copy link"
            size="xs"
            onClick={() =>
              copyLink({
                kind: "decision",
                taskId: decision.taskId,
                threadId: decision.threadId,
                decisionId: decision.id,
              })
            }
          />
        </div>
        <div className="message-text decision-question">
          <MarkdownText text={decision.question} />
        </div>
        {children}
      </CardColumns>
    </section>
  );
}

/** What the person found, and who passed the Decision on. */
function DecisionDetail({
  decision,
  roles,
}: {
  readonly decision: Decision;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  return (
    <>
      {decision.context !== "" && (
        <div className="decision-context">
          <MarkdownText text={decision.context} />
        </div>
      )}
      {decision.passedOn.map(({ roleKey, reason, passedOnAt }) => (
        <p key={passedOnAt} className="decision-passed-on">
          <Icon name="users" size={12} />
          <span>
            {consultantName(roleKey, roles)} passed it on: <MarkdownText text={reason} inline />
          </span>
        </p>
      ))}
    </>
  );
}

function OpenDecision({
  decision,
  personName,
  answering,
  followUps,
  consultantName: consulted,
}: {
  readonly decision: Decision;
  readonly personName: string;
  readonly answering: boolean;
  readonly followUps: boolean;
  /** The Consultant the Decision waits on, in a Consultation; undefined when it waits on the user. */
  readonly consultantName: string | undefined;
}): ReactNode {
  const [freeAnswer, setFreeAnswer] = useState("");
  const answeringDecision = useAnswering(decision);
  const busy = answering || answeringDecision.isPending;
  const recommended = decision.recommendation.option;
  const byTheOffice = decision.roleKey === null;
  const waitHint = answering
    ? `${personName} is still answering. Answer once they finish.`
    : undefined;
  const canSendFreeAnswer = !busy && freeAnswer.trim() !== "";
  const sendFreeAnswer = (): void =>
    answeringDecision.mutate(
      { kind: "free-answer", text: freeAnswer },
      { onSuccess: () => setFreeAnswer("") },
    );
  return (
    <>
      {consulted !== undefined && (
        <p className="decision-consultation" role="note">
          <Icon name="users" size={12} />
          Waiting on {consulted} in a Consultation. Answer here to take it over.
        </p>
      )}
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
          sendFreeAnswer();
        }}
      >
        <MessageField
          label="Your answer"
          rows={2}
          placeholder="Or answer in your own words…"
          value={freeAnswer}
          onChange={setFreeAnswer}
          canSend={canSendFreeAnswer}
          busyReason={waitHint}
          onSend={sendFreeAnswer}
        />
        <Button
          size="sm"
          variant="secondary"
          type="submit"
          disabled={!canSendFreeAnswer}
          title={waitHint}
        >
          Answer
        </Button>
      </form>
      {followUps && !byTheOffice && (
        <p className="decision-hint">
          A question first? Ask {personName} in the Thread; the Decision stays open.
        </p>
      )}
      {answeringDecision.error && (
        <RefusalAlert title="The answer wasn't sent" error={answeringDecision.error} />
      )}
    </>
  );
}

/** A Consultant's name from the Role they fill; the key itself when the Role is gone. */
function consultantName(roleKey: string, roles: readonly Role[] | undefined): string {
  return roles?.find(({ key }) => key === roleKey)?.card.name ?? roleKey;
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
        queryClient.invalidateQueries(decisionQueries.unanswered(decision.taskId)),
      ]);
    },
  });
}

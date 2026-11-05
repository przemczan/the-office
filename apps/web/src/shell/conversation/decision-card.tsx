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
import { useCopyRecordLink } from "../copy-record-link.ts";
import { MarkdownText } from "../markdown-text.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import { answerWords, namedAttachments } from "./decision-words.ts";
import { NamedTag, PersonTag } from "../person-tag.tsx";
import { MessageField } from "./message-field.tsx";
import "./conversation.css";

/**
 * An open Decision with nothing to look at, whole (spec §2.4): the question, what they found, each
 * answer on its own line with the recommended one marked, and a free answer. Follow-ups are
 * ordinary messages in its Thread, and leave it open, except in a Stage Thread, where The Office
 * sends the messages once no Stage runs. Nothing is answered while the person is still answering.
 * The Office's own Decisions about the Task's Pipeline show the same way, as The Office's.
 */
export function DecisionCard({
  decision,
  personName,
  answering,
  followUps,
  place,
  landing = false,
}: DecisionCardProps): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  return (
    <DecisionFrame
      decision={decision}
      personName={personName}
      elementId={landing ? decisionCardElementId(decision.id) : undefined}
      place={place}
    >
      <DecisionDetail decision={decision} roles={roles} />
      <OpenDecision
        decision={decision}
        personName={personName}
        answering={answering}
        followUps={followUps}
        roles={roles}
      />
    </DecisionFrame>
  );
}

/** What every form of an open Decision the user answers is given. */
export interface DecisionCardProps {
  readonly decision: Decision;
  readonly personName: string;
  readonly answering: boolean;
  /** The user can ask the person something first in the Thread. */
  readonly followUps: boolean;
  /** Where or when it was asked, in the card's first line. */
  readonly place?: ReactNode;
  /** The card a link to the Decision lands on: the page's, not the panel's open over it. */
  readonly landing?: boolean;
}

/** The Attachments the Decision names that the Task still holds; undefined until they are read. */
export function useNamedAttachments(decision: Decision): readonly Attachment[] | undefined {
  const { data } = useQuery({
    ...attachmentQueries.of({ kind: "task", taskId: decision.taskId }),
    enabled: decision.attachmentIds.length > 0,
  });
  if (decision.attachmentIds.length === 0) return [];
  return data && namedAttachments(decision, data);
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

export function decisionCardElementId(decisionId: string): string {
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
export function DecisionFrame({
  decision,
  personName,
  elementId,
  place,
  children,
}: {
  readonly decision: Decision;
  readonly personName: string;
  readonly elementId?: string | undefined;
  readonly place?: ReactNode;
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
      <div className="message-by">
        <Badge tone="warning">Decision</Badge>
        <AskerTag decision={decision} personName={personName} />
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
    </section>
  );
}

export function AskerTag({
  decision: { roleKey },
  personName,
}: {
  readonly decision: Decision;
  readonly personName: string;
}): ReactNode {
  return roleKey === null ? (
    <NamedTag name="The Office" />
  ) : (
    <PersonTag roleKey={roleKey} name={personName} />
  );
}

/** What the person found, and who passed the Decision on. */
export function DecisionDetail({
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
  roles,
}: {
  readonly decision: Decision;
  readonly personName: string;
  readonly answering: boolean;
  readonly followUps: boolean;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const [freeAnswer, setFreeAnswer] = useState("");
  const answeringDecision = useAnswering(decision);
  const busy = answering || answeringDecision.isPending;
  const recommended = decision.recommendation.option;
  const waitHint = stillAnsweringHint(answering, personName);
  const canSendFreeAnswer = !busy && freeAnswer.trim() !== "";
  const sendFreeAnswer = (): void =>
    answeringDecision.mutate(
      { kind: "free-answer", text: freeAnswer },
      { onSuccess: () => setFreeAnswer("") },
    );
  return (
    <>
      <ConsultationNote decision={decision} roles={roles} />
      <div className="decision-options" role="group" aria-label="Options">
        {decision.options.map((option, index) => (
          <Button
            key={option}
            variant={index === recommended ? "primary" : "secondary"}
            disabled={busy}
            title={waitHint}
            fullWidth
            style={ANSWER_ON_A_LINE}
            iconRight={
              index === recommended && (
                // Marked to the eye; the recommendation under the answers says it in words.
                <span className="decision-option-tag" aria-hidden="true">
                  Recommended
                </span>
              )
            }
            onClick={() => answeringDecision.mutate({ kind: "option", option: index })}
          >
            <span className="decision-option-words">{option}</span>
          </Button>
        ))}
      </div>
      <Recommendation decision={decision} personName={personName} />
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
          placeholder="Or answer in your own words"
          value={freeAnswer}
          onChange={setFreeAnswer}
          canSend={canSendFreeAnswer}
          busyReason={waitHint}
          onSend={sendFreeAnswer}
        />
        <Button variant="secondary" type="submit" disabled={!canSendFreeAnswer} title={waitHint}>
          Answer
        </Button>
      </form>
      <FollowUpsHint decision={decision} personName={personName} followUps={followUps} />
      {answeringDecision.error && <AnswerRefused error={answeringDecision.error} />}
    </>
  );
}

/** The design system's Button holds its label on one centred line; an answer may be a sentence. */
const ANSWER_ON_A_LINE = {
  justifyContent: "flex-start",
  height: "auto",
  minHeight: 32,
  paddingBlock: 6,
  whiteSpace: "normal",
  textAlign: "left",
  lineHeight: 1.35,
} as const;

/** In a Consultation, whom the Decision waits on, and that answering takes it over. */
export function ConsultationNote({
  decision,
  roles,
}: {
  readonly decision: Decision;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  if (decision.putTo === null) return null;
  return (
    <p className="decision-consultation" role="note">
      <Icon name="users" size={12} />
      Waiting on {consultantName(decision.putTo, roles)} in a Consultation. Answer here to take it
      over.
    </p>
  );
}

export function Recommendation({
  decision,
  personName,
}: {
  readonly decision: Decision;
  readonly personName: string;
}): ReactNode {
  return (
    <p className="decision-recommendation">
      {askerName(decision, personName)} recommends “
      {decision.options[decision.recommendation.option]}”:{" "}
      <MarkdownText text={decision.recommendation.reason} inline />
    </p>
  );
}

/** Follow-ups are messages in the person's Thread, which the user writes only outside a Stage. */
export function FollowUpsHint({
  decision,
  personName,
  followUps,
}: {
  readonly decision: Decision;
  readonly personName: string;
  readonly followUps: boolean;
}): ReactNode {
  if (!followUps || decision.roleKey === null) return null;
  return (
    <p className="decision-hint">
      A question first? Ask {personName} in the Thread; the Decision stays open.
    </p>
  );
}

export function AnswerRefused({ error }: { readonly error: Error }): ReactNode {
  return <RefusalAlert title="The answer wasn't sent" error={error} />;
}

/** Why the answers wait: nothing is answered while the person is still answering. */
export function stillAnsweringHint(answering: boolean, personName: string): string | undefined {
  return answering ? `${personName} is still answering. Answer once they finish.` : undefined;
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
export function useAnswering(decision: Decision): UseMutationResult<Thread, Error, DecisionAnswer> {
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

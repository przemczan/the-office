import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import type {
  Attachment,
  Decision,
  DecisionFormAnswer,
  Role,
  Thread,
  ThreadSummary,
} from "@the-office/contracts";
import { Badge, Button, Icon, IconButton } from "@the-office/ui";
import type { ReactNode } from "react";
import { answerDecision, decisionQueries, threadQueries } from "../../api/conversations.ts";
import { rowsOf } from "../../api/pages.ts";
import { attachmentQueries } from "../../api/work.ts";
import { roleQueries } from "../../api/people.ts";
import { useCopyRecordLink } from "../copy-record-link.ts";
import { MarkdownText } from "../markdown-text.tsx";
import { NamedTag, PersonTag } from "../person-tag.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useTakeOver } from "./decision-drafts.tsx";
import { closedWords, namedAttachments } from "./decision-words.ts";
import { ThreadLink } from "./thread-link.tsx";
import "./conversation.css";

/** What every form of an open Decision the user answers is given. */
export interface DecisionAnsweringProps {
  readonly decision: Decision;
  readonly personName: string;
  /** The person is answering, so the Decision can't be answered yet. */
  readonly answering: boolean;
  /**
   * The person is answering in an Initiative's planning Thread, where an answer is taken at once
   * and reaches them when their turn ends.
   */
  readonly reachesAtTurnEnd?: boolean;
  /** The user can ask the person something first in the Thread. */
  readonly followUps: boolean;
}

/**
 * What a Decision's Thread says of its card, wherever the card shows. In an Initiative's planning
 * Thread the answer is taken while the Planner works, and reaches them when the turn ends.
 */
export function useDecisionThread(
  decision: Decision,
  roles: readonly Role[] | undefined,
): {
  readonly thread: Thread | undefined;
  readonly card: Required<Omit<DecisionAnsweringProps, "decision">>;
} {
  const thread = useQuery(threadQueries.one(decision.threadId)).data;
  const working = thread?.state === "answering";
  const inInitiative = thread?.home.kind === "initiative";
  return {
    thread,
    card: {
      personName: roles?.find(({ key }) => key === decision.roleKey)?.card.name ?? "The Office",
      answering: working && !inInitiative,
      reachesAtTurnEnd: working && inInitiative,
      followUps: thread?.stageThread === false,
    },
  };
}

/**
 * The Attachments the Decision names that its Task, or for one on no Task in an Initiative's Thread
 * its Initiative, still holds; undefined until they are read.
 */
export function useNamedAttachments(decision: Decision): readonly Attachment[] | undefined {
  const names = decision.attachmentIds.length > 0;
  const home = useQuery({
    ...threadQueries.one(decision.threadId),
    enabled: names && decision.taskId === null,
  }).data?.home;
  const initiativeId =
    decision.taskId === null && home?.kind === "initiative" ? home.initiativeId : undefined;
  const owner =
    decision.taskId !== null
      ? { kind: "task" as const, taskId: decision.taskId }
      : { kind: "initiative" as const, initiativeId: initiativeId ?? "" };
  const { data } = useQuery({
    ...attachmentQueries.of(owner),
    // A call made from a chat names no Attachments, as it is on no Task and no Initiative.
    enabled: names && (decision.taskId !== null || initiativeId !== undefined),
  });
  if (!names) return [];
  if (decision.taskId === null && home !== undefined && home.kind !== "initiative") return [];
  return data && namedAttachments(decision, data);
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

/**
 * What every form of a Decision has: who asked, how many questions, a request's words, and its
 * link, which mentions it in a chat and opens the Task's page at it, marked. A call made from a
 * chat, on no Task, has no link. Once nothing waits on it, it is settled: without the amber.
 */
export function DecisionFrame({
  decision,
  personName,
  label,
  elementId,
  place,
  settled = false,
  children,
}: {
  readonly decision: Decision;
  readonly personName: string;
  /** What the card is called for assistive technology. */
  readonly label: string;
  readonly elementId?: string | undefined;
  readonly place?: ReactNode;
  readonly settled?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const copyLink = useCopyRecordLink();
  const roles = useQuery(roleQueries.list()).data;
  const { taskId } = decision;
  const linkedTo = useSearch({ strict: false }).decision === decision.id;
  const count = decision.questions.length;
  const classes = ["message", "decision-card"];
  if (settled) classes.push("settled");
  if (linkedTo) classes.push("linked-to");
  return (
    <section
      id={elementId}
      className={classes.join(" ")}
      aria-label={label}
      aria-current={linkedTo || undefined}
    >
      <div className="message-by">
        <DecisionHeading decision={decision} personName={personName} settled={settled} />
        {count > 1 && <span className="decision-count">· {count} questions</span>}
        {place}
        {taskId !== null && (
          <IconButton
            className="decision-copy-link"
            icon={<Icon name="link" size={12} />}
            label="Copy link"
            size="xs"
            onClick={() =>
              copyLink({
                kind: "decision",
                taskId,
                threadId: decision.threadId,
                decisionId: decision.id,
              })
            }
          />
        )}
      </div>
      {decision.kind === "request" && (
        <div className="message-text decision-question">
          <MarkdownText text={requestWords(decision, roles)} />
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * The Decision's header: who asked and, when it was put to a Consultant, whom it waits on, so a
 * Decision that isn't the user's reads so at a glance (spec §2.4). It keeps whom it was put to once
 * answered.
 */
export function DecisionHeading({
  decision,
  personName,
  settled = false,
}: {
  readonly decision: Decision;
  readonly personName: string;
  readonly settled?: boolean;
}): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  return (
    <>
      <Badge tone={settled ? "neutral" : "warning"}>Decision</Badge>
      {decision.roleKey === null ? (
        <NamedTag name="The Office" />
      ) : (
        <PersonTag roleKey={decision.roleKey} name={personName} />
      )}
      {decision.putTo !== null && (
        <>
          <span className="decision-put-to">to</span>
          <PersonTag roleKey={decision.putTo} name={consultantName(decision.putTo, roles)} />
        </>
      )}
    </>
  );
}

/** A request reads as what the asker asked the person it is put to, or the user, to do. */
function requestWords(decision: Decision, roles: readonly Role[] | undefined): string {
  const callee = decision.putTo === null ? "you" : consultantName(decision.putTo, roles);
  return `Asked ${callee} to: ${decision.questions[0]?.question ?? ""}`;
}

/** What the person found, whole, and who passed the Decision on. */
export function DecisionDetail({ decision }: { readonly decision: Decision }): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
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

/** The context's first line, for a card that keeps it short. */
export function ContextFirstLine({ decision }: { readonly decision: Decision }): ReactNode {
  const line = decision.context.split("\n").find((written) => written.trim() !== "");
  if (line === undefined) return null;
  return (
    <p className="decision-context first-line">
      <MarkdownText text={line} inline />
    </p>
  );
}

/**
 * In a Consultation, whom the Decision waits on, and Take it over, which unlocks the form; answering
 * then takes it over.
 */
export function ConsultationNote({ decision }: { readonly decision: Decision }): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  const { locked, takeOver } = useTakeOver(decision);
  if (decision.putTo === null) return null;
  const consultant = consultantName(decision.putTo, roles);
  return (
    <div className="decision-consultation" role="note">
      <Icon name="users" size={12} />
      <span>
        Waiting on {consultant} in a Consultation.{" "}
        {locked ? "Take it over to answer here." : "Your answer here takes it over."}
      </span>
      {locked && (
        <Button variant="secondary" size="sm" onClick={takeOver}>
          Take it over
        </Button>
      )}
    </div>
  );
}

/** Why a Decision put to a Consultant can't be answered yet. */
export const TAKE_IT_OVER_FIRST = "Take it over first.";

/** Follow-ups are messages in the person's Thread, which the user writes only outside a Stage. */
export function FollowUpsHint({
  decision,
  personName,
  followUps,
  where = "in the Thread",
}: {
  readonly decision: Decision;
  readonly personName: string;
  readonly followUps: boolean;
  /** Where the user asks: "in the Thread", or "below" for a card in a chat. */
  readonly where?: string;
}): ReactNode {
  if (!followUps || decision.roleKey === null) return null;
  return (
    <p className="decision-hint">
      A question first? Ask {personName} {where}; the Decision stays open.
    </p>
  );
}

export function AnswerRefused({ error }: { readonly error: Error }): ReactNode {
  return <RefusalAlert title="The answer wasn't sent" error={error} />;
}

/**
 * Why the answers wait, or that they reach the person later: nothing is answered while the person
 * is still answering, but in an Initiative's planning Thread, where the answer is taken now and
 * reaches them once their turn ends.
 */
export function AnsweringHints({
  personName,
  answering,
  reachesAtTurnEnd,
}: {
  readonly personName: string;
  readonly answering: boolean;
  readonly reachesAtTurnEnd: boolean;
}): ReactNode {
  if (reachesAtTurnEnd) {
    return (
      <p className="decision-hint decision-reach">Reaches {personName} when this turn ends.</p>
    );
  }
  const waiting = stillAnsweringHint(answering, personName);
  return waiting === undefined ? null : <p className="decision-hint">{waiting}</p>;
}

/** Why the answers wait: nothing is answered while the person is still answering. */
export function stillAnsweringHint(answering: boolean, personName: string): string | undefined {
  return answering ? `${personName} is still answering. Answer once they finish.` : undefined;
}

/**
 * A Decision closed unanswered, as its Task was dropped or its Initiative ended: in the answer's
 * place, with nothing left to answer or take over (spec §2.4).
 */
export function ClosedLine({ decision }: { readonly decision: Decision }): ReactNode {
  return (
    <p className="decision-answered decision-closed">
      <Icon name="x" size={12} />
      <span>{closedWords(decision)}</span>
    </p>
  );
}

/**
 * The way to the Consultation of a Decision put to `consultantKey`, once it has opened: on its Task,
 * or in the callee's chat for a call made from a chat (spec §2.4).
 */
export function LinkToConsultation({
  decision,
  consultantKey,
}: {
  readonly decision: Decision;
  readonly consultantKey: string;
}): ReactNode {
  const consultationId = useConsultationId(decision, consultantKey);
  if (consultationId === undefined) return null;
  return <ThreadLink threadId={consultationId}>Open the Consultation</ThreadLink>;
}

/** The Thread of the Decision's Consultation with `consultantKey`; undefined until it is found. */
export function useConsultationId(
  decision: Decision,
  consultantKey: string | null,
): string | undefined {
  const onNoTask = decision.taskId === null;
  // A Consultation opens as the Decision is put, so while it waits it is among the chat's newest.
  const inChat = useInfiniteQuery({
    ...threadQueries.inChat(consultantKey ?? ""),
    enabled: onNoTask && consultantKey !== null,
  });
  const onTask = useQuery({
    ...threadQueries.onTask(decision.taskId ?? ""),
    enabled: !onNoTask && consultantKey !== null,
  });
  if (consultantKey === null) return undefined;
  const threads: readonly Pick<ThreadSummary, "id" | "roleKey" | "consultation">[] = onNoTask
    ? rowsOf(inChat.data)
    : (onTask.data ?? []);
  return threads.find(
    (thread) => thread.consultation?.decisionId === decision.id && thread.roleKey === consultantKey,
  )?.id;
}

/** A Consultant's name from the Role they fill; the key itself when the Role is gone. */
export function consultantName(roleKey: string, roles: readonly Role[] | undefined): string {
  return roles?.find(({ key }) => key === roleKey)?.card.name ?? roleKey;
}

/** Who asked: the Thread's person, or The Office, which has no person (spec §9). */
export function askerName(decision: Pick<Decision, "roleKey">, personName: string): string {
  return decision.roleKey === null ? "The Office" : personName;
}

/**
 * Sends the form; the asking person takes it in the Thread, which answers with its state. Once sent
 * the draft goes; a refused one keeps it (`onSent`).
 */
export function useAnswering(
  decision: Decision,
  onSent?: () => void,
): UseMutationResult<Thread, Error, DecisionFormAnswer> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (answer: DecisionFormAnswer) => answerDecision(decision.id, answer),
    onSuccess: async (thread) => {
      onSent?.();
      queryClient.setQueryData(threadQueries.one(thread.id).queryKey, thread);
      await Promise.all([
        queryClient.invalidateQueries(threadQueries.messages(thread.id)),
        queryClient.invalidateQueries(decisionQueries.open()),
        ...(decision.taskId === null
          ? []
          : [queryClient.invalidateQueries(decisionQueries.unanswered(decision.taskId))]),
      ]);
    },
  });
}

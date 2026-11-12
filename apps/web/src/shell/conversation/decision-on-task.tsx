import { useQuery } from "@tanstack/react-query";
import type { Attachment, Decision, Role, Thread } from "@the-office/contracts";
import { Badge, Button, Dialog, RadioList, Textarea } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { AttachmentGallery } from "../attachments/attachment-gallery.tsx";
import { oneRound } from "../attachments/attachment-rounds.ts";
import { MarkdownText } from "../markdown-text.tsx";
import {
  AnswerRefused,
  ConsultationNote,
  DecisionCard,
  decisionCardElementId,
  DecisionDetail,
  DecisionFrame,
  DecisionHeading,
  FollowUpsHint,
  ReachesAtTurnEndHint,
  Recommendation,
  stillAnsweringHint,
  useAnswering,
  useNamedAttachments,
  type DecisionCardProps,
} from "./decision-card.tsx";
import { decisionDetailsWords } from "./decision-words.ts";

/**
 * What a Decision's Thread says of its card, wherever the card shows. In an Initiative's planning
 * Thread the answer is taken while the Planner works, and reaches them when the turn ends.
 */
export function useDecisionThread(
  decision: Decision,
  roles: readonly Role[] | undefined,
): {
  readonly thread: Thread | undefined;
  readonly card: Required<
    Pick<DecisionCardProps, "personName" | "answering" | "reachesAtTurnEnd" | "followUps">
  >;
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
 * An open Decision where the user answers it, on its Task's page, on Now and in the Needs you panel
 * (spec §4). With nothing to look at it is answered in place, each answer on its own line. With
 * Attachments it shows the recommended answer to accept, and everything else, pictures included, in
 * its details window.
 */
export function DecisionOnTask(props: DecisionCardProps): ReactNode {
  const attachments = useNamedAttachments(props.decision);
  if (attachments === undefined) return null;
  if (attachments.length === 0) return <DecisionCard {...props} />;
  return <DecisionToLookAt {...props} attachments={attachments} />;
}

function DecisionToLookAt({
  decision,
  personName,
  answering,
  reachesAtTurnEnd = false,
  followUps,
  place,
  landing = false,
  attachments,
}: DecisionCardProps & { readonly attachments: readonly Attachment[] }): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const accepting = useAnswering(decision);
  const waitHint = stillAnsweringHint(answering, personName);
  const recommended = decision.recommendation.option;
  return (
    <DecisionFrame
      decision={decision}
      personName={personName}
      elementId={landing ? decisionCardElementId(decision.id) : undefined}
      place={place}
    >
      <ConsultationNote decision={decision} roles={roles} />
      <div className="decision-boxes">
        <section className="decision-box" aria-label="Recommended answer">
          <div className="decision-box-overline">Recommended answer</div>
          <p className="decision-box-main">{decision.options[recommended]}</p>
          <div className="decision-box-words">
            <MarkdownText text={decision.recommendation.reason} inline />
          </div>
          <div className="decision-box-foot">
            <Button
              disabled={answering || accepting.isPending}
              title={waitHint}
              onClick={() => accepting.mutate({ kind: "option", option: recommended })}
            >
              Accept
            </Button>
          </div>
        </section>
        <section className="decision-box" aria-label="Details">
          <div className="decision-box-overline">Details</div>
          <p className="decision-box-main">{decisionDetailsWords(decision, attachments)}</p>
          <p className="decision-box-words">
            The context, every answer, your own words and the Attachments to look at.
          </p>
          <div className="decision-box-foot">
            <Button variant="secondary" onClick={() => setDetailsOpen(true)}>
              Open details
            </Button>
          </div>
        </section>
      </div>
      <ReachesAtTurnEndHint personName={personName} reachesAtTurnEnd={reachesAtTurnEnd} />
      {accepting.error && <AnswerRefused error={accepting.error} />}
      {detailsOpen && (
        <DecisionWindow
          decision={decision}
          personName={personName}
          answering={answering}
          reachesAtTurnEnd={reachesAtTurnEnd}
          followUps={followUps}
          roles={roles}
          attachments={attachments}
          onClose={() => setDetailsOpen(false)}
        />
      )}
    </DecisionFrame>
  );
}

/** A waiting Decision's window, opened from a Mention of it rather than from its card. */
export function MentionedDecisionWindow({
  decision,
  onClose,
}: {
  readonly decision: Decision;
  readonly onClose: () => void;
}): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  const { card } = useDecisionThread(decision, roles);
  const attachments = useNamedAttachments(decision);
  if (attachments === undefined) return null;
  return (
    <DecisionWindow
      decision={decision}
      personName={card.personName}
      answering={card.answering}
      reachesAtTurnEnd={card.reachesAtTurnEnd}
      followUps={card.followUps}
      roles={roles}
      attachments={attachments}
      onClose={onClose}
    />
  );
}

/** The value of "In your own words" among the answers' indexes. */
const OWN_WORDS = "own-words";

/**
 * The Decision answered as a form (spec 4.1, "Answering in a window is a form"): the recommended
 * answer picked at first, or your own words, then Answer in the bar.
 */
function DecisionWindow({
  decision,
  personName,
  answering,
  reachesAtTurnEnd,
  followUps,
  roles,
  attachments,
  onClose,
}: {
  readonly decision: Decision;
  readonly personName: string;
  readonly answering: boolean;
  readonly reachesAtTurnEnd: boolean;
  readonly followUps: boolean;
  readonly roles: readonly Role[] | undefined;
  readonly attachments: readonly Attachment[];
  readonly onClose: () => void;
}): ReactNode {
  const recommended = decision.recommendation.option;
  const [picked, setPicked] = useState(String(recommended));
  const [ownWords, setOwnWords] = useState("");
  const answeringDecision = useAnswering(decision);
  const busy = answering || answeringDecision.isPending;
  const inOwnWords = picked === OWN_WORDS;
  const canAnswer = !busy && (!inOwnWords || ownWords.trim() !== "");
  const answer = (): void =>
    answeringDecision.mutate(
      inOwnWords
        ? { kind: "free-answer", text: ownWords }
        : { kind: "option", option: Number(picked) },
      { onSuccess: onClose },
    );
  return (
    <Dialog
      size="large"
      title={
        <span className="decision-window-title">
          <DecisionHeading decision={decision} personName={personName} />
        </span>
      }
      onClose={onClose}
      actions={
        <Button
          disabled={!canAnswer}
          title={stillAnsweringHint(answering, personName)}
          onClick={answer}
        >
          Answer
        </Button>
      }
    >
      <div className="decision-window">
        <div className="decision-question">
          <MarkdownText text={decision.question} />
        </div>
        <DecisionDetail decision={decision} roles={roles} />
        <ConsultationNote decision={decision} roles={roles} />
        <AttachmentGallery rounds={oneRound(attachments)} />
        <RadioList
          label="Answers"
          name={`answer-${decision.id}`}
          value={picked}
          onChange={setPicked}
          disabled={busy}
          options={[
            ...decision.options.map((option, index) => ({
              value: String(index),
              label: option,
              aside: index === recommended && <Badge tone="info">Recommended</Badge>,
            })),
            { value: OWN_WORDS, label: "In your own words" },
          ]}
        />
        {inOwnWords && (
          <Textarea
            label="Your answer"
            rows={3}
            value={ownWords}
            disabled={busy}
            autoFocus
            onChange={(event) => setOwnWords(event.target.value)}
          />
        )}
        <Recommendation decision={decision} personName={personName} />
        <ReachesAtTurnEndHint personName={personName} reachesAtTurnEnd={reachesAtTurnEnd} />
        <FollowUpsHint decision={decision} personName={personName} followUps={followUps} />
        {answeringDecision.error && <AnswerRefused error={answeringDecision.error} />}
      </div>
    </Dialog>
  );
}

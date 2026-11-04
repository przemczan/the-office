import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import type { Decision, Role, Task, TaskStages } from "@the-office/contracts";
import { Badge, Button, Icon } from "@the-office/ui";
import { useEffect, useState, type ReactNode } from "react";
import { decisionQueries, threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import {
  bringDecisionCardIntoView,
  DecisionCard,
} from "../../shell/conversation/decision-card.tsx";
import { MarkdownText } from "../../shell/markdown-text.tsx";
import { clockOf } from "../../shell/time.ts";
import { waitingGateOf, type WaitingGate } from "../../shell/work/gate-words.ts";
import { GateCard } from "./gate-card.tsx";
import { gateQuestion } from "./gate-card-words.ts";
import { needsYouSummary, nothingNeedsYouWords, waitingOnYou } from "./needs-you-words.ts";
import { RecordBlock } from "./record-block.tsx";
import { useInView } from "./use-in-view.ts";

/**
 * What waits on the user on this Task, under the rail and answered there (spec §4): its Decisions,
 * those with a Consultant marked and not counted, and the Gate it waits at. It says so when nothing
 * waits.
 */
export function NeedsYouCard({ task }: { readonly task: Task }): ReactNode {
  const decisions = useQuery(decisionQueries.unanswered(task.id)).data;
  const taskStages = useQuery(pipelineQueries.taskStages(task.id)).data;
  if (!decisions || !taskStages) return null;
  const waiting = taskStages.stages ? waitingGateOf(taskStages.stages) : undefined;
  if (decisions.length > 0 || waiting) {
    return (
      <WhatWaits task={task} decisions={decisions} taskStages={taskStages} waiting={waiting} />
    );
  }
  // The record's Before Ready says what waits, until it moves into this card.
  if (task.state === "planning") return null;
  return (
    <section className="needs-you-clear" aria-label="Needs you">
      <Icon name="check" size={14} />
      {nothingNeedsYouWords(task.state)}
    </section>
  );
}

function WhatWaits({
  task,
  decisions,
  taskStages,
  waiting,
}: {
  readonly task: Task;
  readonly decisions: readonly Decision[];
  readonly taskStages: TaskStages;
  readonly waiting: WaitingGate | undefined;
}): ReactNode {
  const [card, setCard] = useState<HTMLElement | null>(null);
  const inView = useInView(card);
  const roles = useQuery(roleQueries.list()).data;
  const { decision: linkedTo } = useSearch({ from: "/tasks/$taskId" });
  useEffect(() => {
    if (linkedTo !== undefined) bringDecisionCardIntoView(linkedTo);
  }, [linkedTo]);
  const onYou = waitingOnYou(decisions);
  const count = onYou.length + (waiting ? 1 : 0);
  const headline = onYou[0]?.question ?? (waiting && gateQuestion(waiting));
  return (
    <>
      {headline !== undefined && !inView && (
        <NeedsYouBar
          count={count}
          question={headline}
          onShow={() => card?.scrollIntoView({ block: "start" })}
        />
      )}
      <div className="needs-you-card" ref={setCard}>
        <RecordBlock
          icon="hand"
          title="Needs you"
          actions={
            <span className="needs-you-summary">
              {count > 0 && <Badge tone="warning">{count}</Badge>}
              {needsYouSummary(decisions, waiting !== undefined)}
            </span>
          }
        >
          <div className="needs-you-list">
            {decisions.map((decision) => (
              <WaitingDecision key={decision.id} decision={decision} roles={roles} />
            ))}
            {waiting && (
              <GateCard task={task} taskStages={taskStages} waiting={waiting} roles={roles} />
            )}
          </div>
        </RecordBlock>
      </div>
    </>
  );
}

function WaitingDecision({
  decision,
  roles,
}: {
  readonly decision: Decision;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const thread = useQuery(threadQueries.one(decision.threadId)).data;
  const personName = roles?.find(({ key }) => key === decision.roleKey)?.card.name ?? "The Office";
  return (
    <DecisionCard
      decision={decision}
      personName={personName}
      answering={thread?.state === "answering"}
      followUps={thread?.stageThread === false}
      landing
      place={
        thread && (
          <Link
            from="/tasks/$taskId"
            to="."
            search={(shown) => ({ ...shown, taskThread: thread.id })}
          >
            in {thread.title ?? "its Thread"} · {clockOf(decision.askedAt)}
          </Link>
        )
      }
    />
  );
}

/**
 * Keeps what waits in sight while the card is scrolled out of view. It sits where the card does,
 * taking no room, and sticks to whichever edge of the page the card went past.
 */
function NeedsYouBar({
  count,
  question,
  onShow,
}: {
  readonly count: number;
  readonly question: string;
  readonly onShow: () => void;
}): ReactNode {
  return (
    <div className="needs-you-bar-place">
      <div className="needs-you-bar" role="group" aria-label="Needs you, out of view">
        <Badge tone="warning">{count}</Badge>
        <strong>Needs you</strong>
        <span className="needs-you-bar-question">
          <MarkdownText text={question} inline />
        </span>
        <Button size="sm" onClick={onShow}>
          Show
        </Button>
      </div>
    </div>
  );
}

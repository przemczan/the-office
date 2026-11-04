import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import type { Decision, Pipeline, Role, Task, TaskStage, TaskStages } from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
import { useEffect, useState, type ReactNode } from "react";
import { decisionQueries, threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { taskQueries } from "../../api/work.ts";
import {
  bringDecisionCardIntoView,
  DecisionCard,
} from "../../shell/conversation/decision-card.tsx";
import { MarkdownText } from "../../shell/markdown-text.tsx";
import { clockOf } from "../../shell/time.ts";
import { waitingGateOf, type WaitingGate } from "../../shell/work/gate-words.ts";
import { UsageEstimateLine } from "../../shell/work/usage-estimate-line.tsx";
import { BeforeReady } from "./before-ready.tsx";
import { useBringThreadIntoView } from "./conversation-drawer.tsx";
import { GateCard } from "./gate-card.tsx";
import { gateQuestion } from "./gate-card-words.ts";
import { needsYouClearWords, needsYouSummary, waitingOnYou } from "./needs-you-words.ts";
import { useQueued } from "./queue-parts.tsx";
import { chapterPlace, chapterWork } from "./timeline-words.ts";
import { useInView } from "./use-in-view.ts";

/**
 * What waits on the user on this Task, under the rail and answered there (spec §4): its Decisions,
 * those with a Consultant marked and not counted, and the Gate it waits at. In Planning this place
 * holds Before Ready, beside any Decision. Otherwise it says where the Task stands.
 */
export function NeedsYouCard({
  task,
  pipeline,
}: {
  readonly task: Task;
  readonly pipeline: Pipeline | undefined;
}): ReactNode {
  const decisions = useQuery(decisionQueries.unanswered(task.id)).data;
  const taskStages = useQuery(pipelineQueries.taskStages(task.id)).data;
  if (!decisions || !taskStages) return null;
  if (task.state === "dropped") return <NothingWaits task={task} />;
  const waiting = taskStages.stages ? waitingGateOf(taskStages.stages) : undefined;
  const beforeReady =
    task.state === "planning" ? <BeforeReady task={task} pipeline={pipeline} /> : undefined;
  if (decisions.length > 0 || waiting) {
    return (
      <WhatWaits
        task={task}
        decisions={decisions}
        taskStages={taskStages}
        waiting={waiting}
        beforeReady={beforeReady}
      />
    );
  }
  return beforeReady ?? <NothingWaits task={task} />;
}

function NothingWaits({ task }: { readonly task: Task }): ReactNode {
  const queued = useQueued(task.id) !== undefined;
  return (
    <section className="needs-you-clear" aria-label="Needs you">
      <Icon name={task.state === "dropped" ? "x" : "circle-check"} size={16} />
      <div className="needs-you-clear-words">
        {needsYouClearWords(task.state, queued)}
        {task.state === "ready" && !queued && <StartsUsing task={task} />}
      </div>
    </section>
  );
}

/** The Usage estimate Start weighs, from the same start check as Start in the head. */
function StartsUsing({ task }: { readonly task: Task }): ReactNode {
  const check = useQuery(taskQueries.startCheck(task.id));
  return <UsageEstimateLine estimate={check.data?.usageEstimate} />;
}

function WhatWaits({
  task,
  decisions,
  taskStages,
  waiting,
  beforeReady,
}: {
  readonly task: Task;
  readonly decisions: readonly Decision[];
  readonly taskStages: TaskStages;
  readonly waiting: WaitingGate | undefined;
  readonly beforeReady: ReactNode;
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
  const needsYou = (
    <section className="needs-you-card" aria-label="Needs you" ref={setCard}>
      <header className="needs-you-head">
        {count > 0 && <span className="needs-you-count">{count}</span>}
        <h3>Needs you</h3>
        <span className="needs-you-summary">
          {needsYouSummary(decisions, waiting !== undefined)}
        </span>
      </header>
      <div className="needs-you-list">
        {decisions.map((decision) => (
          <WaitingDecision
            key={decision.id}
            decision={decision}
            roles={roles}
            stages={taskStages.stages ?? []}
          />
        ))}
        {waiting && (
          <GateCard task={task} taskStages={taskStages} waiting={waiting} roles={roles} />
        )}
      </div>
    </section>
  );
  return (
    <>
      {headline !== undefined && !inView && (
        <NeedsYouBar
          count={count}
          question={headline}
          onShow={() => card?.scrollIntoView({ block: "start" })}
        />
      )}
      {beforeReady ? (
        <div className="needs-you-beside">
          {beforeReady}
          {needsYou}
        </div>
      ) : (
        needsYou
      )}
    </>
  );
}

function WaitingDecision({
  decision,
  roles,
  stages,
}: {
  readonly decision: Decision;
  readonly roles: readonly Role[] | undefined;
  readonly stages: readonly TaskStage[];
}): ReactNode {
  const thread = useQuery(threadQueries.one(decision.threadId)).data;
  const bringThreadIntoView = useBringThreadIntoView();
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
            className="needs-you-place"
            from="/tasks/$taskId"
            to="."
            search={(shown) => ({ ...shown, taskThread: thread.id })}
            resetScroll={false}
            onClick={() => bringThreadIntoView(thread.id)}
          >
            in {chapterPlace(thread, chapterWork(stages, thread.id)) || "its Thread"} ·{" "}
            {clockOf(decision.askedAt)}
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
        <span className="needs-you-count">{count}</span>
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

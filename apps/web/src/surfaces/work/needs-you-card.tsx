import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import type { Decision, Role, Task, TaskStage, TaskStages } from "@the-office/contracts";
import { Badge, Button, Icon } from "@the-office/ui";
import { useEffect, useState, type ReactNode } from "react";
import { decisionQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { pipelineQueries, standInChoiceQueries } from "../../api/pipelines.ts";
import { taskQueries } from "../../api/work.ts";
import { decisionSummary } from "../../shell/conversation/decision-form-words.ts";
import { DecisionOnTask } from "../../shell/conversation/decision-on-task.tsx";
import {
  bringDecisionCardIntoView,
  useDecisionThread,
} from "../../shell/conversation/decision-parts.tsx";
import { MarkdownText } from "../../shell/markdown-text.tsx";
import { StandInChoiceOnTask } from "../../shell/notifications/stand-in-choice-card.tsx";
import { STAND_IN_CHOICE_TITLE } from "../../shell/notifications/stand-in-choice-words.ts";
import { clockOf } from "../../shell/time.ts";
import { GateCard } from "../../shell/work/gate-card.tsx";
import { gateQuestion } from "../../shell/work/gate-card-words.ts";
import { waitingGateOf, type WaitingGate } from "../../shell/work/gate-words.ts";
import { NeedsYouList } from "../../shell/work/needs-you-list.tsx";
import { UsageEstimateLine } from "../../shell/work/usage-estimate-line.tsx";
import { BeforeReady } from "./before-ready.tsx";
import { useConversationDrawer } from "./conversation-drawer.tsx";
import { ItsInitiativeLink } from "./its-initiative-link.tsx";
import {
  NEEDS_YOU_ELEMENT_ID,
  needsYouClearWords,
  needsYouSummary,
  waitingOnYou,
} from "./needs-you-words.ts";
import { useQueued } from "./queue-parts.tsx";
import { chapterPlace, chapterWork } from "./timeline-words.ts";
import { useInView } from "./use-in-view.ts";

/**
 * What waits on the user on this Task, first in the record's column and answered there (spec §4):
 * its Decisions, those with a Consultant marked and not counted, the Gate it waits at, and while it
 * is Paused by a used-up usage window, The Office's Decision on switching its Stage to a Stand-in
 * Engine, narrowed to this Task. Before
 * Ready holds this place, after any Decision, in Planning and in Backlog once a part is written.
 * Otherwise it says where the Task stands.
 */
export function NeedsYouCard({ task }: { readonly task: Task }): ReactNode {
  const decisions = useQuery(decisionQueries.unanswered(task.id)).data;
  const taskStages = useQuery(pipelineQueries.taskStages(task.id)).data;
  const standInChoice = useStandInChoiceWaits(task);
  if (!decisions || !taskStages) return null;
  if (task.state === "dropped") return <NothingWaits task={task} />;
  const waiting = taskStages.stages ? waitingGateOf(taskStages.stages) : undefined;
  const beforeReady = showsBeforeReady(task) ? <BeforeReady task={task} /> : undefined;
  if (decisions.length > 0 || waiting || standInChoice) {
    return (
      <WhatWaits
        task={task}
        decisions={decisions}
        taskStages={taskStages}
        waiting={waiting}
        standInChoice={standInChoice}
        beforeReady={beforeReady}
      />
    );
  }
  return beforeReady ?? <NothingWaits task={task} />;
}

/**
 * Whether a Stage of the Task waits for the user's choice of a Stand-in Engine; read only while
 * the Task is Paused, as only a Task Paused by the usage window waits so.
 */
function useStandInChoiceWaits(task: Task): boolean {
  const choices = useQuery({
    ...standInChoiceQueries.list(),
    enabled: task.state === "paused",
  }).data;
  return task.state === "paused" && !!choices?.some(({ taskId }) => taskId === task.id);
}

function showsBeforeReady(task: Task): boolean {
  if (task.state === "planning") return true;
  return task.state === "backlog" && (task.plan !== "" || task.definitionOfDone.length > 0);
}

function NothingWaits({ task }: { readonly task: Task }): ReactNode {
  const queued = useQueued(task.id) !== undefined;
  return (
    <section className="needs-you-clear" aria-label="Needs you">
      <Icon name={task.state === "dropped" ? "x" : "circle-check"} size={16} />
      <div className="needs-you-clear-words">
        {needsYouClearWords(task.state, queued)}
        {task.state === "ready" && !queued && <StartsUsing task={task} />}
        {task.state === "shaping" && <ItsInitiativeLink task={task} />}
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
  standInChoice,
  beforeReady,
}: {
  readonly task: Task;
  readonly decisions: readonly Decision[];
  readonly taskStages: TaskStages;
  readonly waiting: WaitingGate | undefined;
  readonly standInChoice: boolean;
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
  const count = onYou.length + (waiting ? 1 : 0) + (standInChoice ? 1 : 0);
  const first = onYou[0];
  const headline = headlineOf(first, waiting, standInChoice);
  const needsYou = (
    <section
      id={NEEDS_YOU_ELEMENT_ID}
      className="needs-you-card"
      aria-label="Needs you"
      ref={setCard}
    >
      <header className="needs-you-head">
        {count > 0 && (
          <Badge tone="warning" size="sm">
            {count}
          </Badge>
        )}
        <h3>Needs you</h3>
        <span className="needs-you-summary">
          {needsYouSummary(decisions, waiting !== undefined, standInChoice)}
        </span>
      </header>
      <NeedsYouList>
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
        {standInChoice && <StandInChoiceOnTask taskId={task.id} />}
      </NeedsYouList>
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
        <div className="needs-you-then-before-ready">
          {needsYou}
          {beforeReady}
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
  const { thread, card } = useDecisionThread(decision, roles);
  const drawer = useConversationDrawer();
  const work = thread && chapterWork(stages, thread.id);
  return (
    <DecisionOnTask
      decision={decision}
      {...card}
      landing
      place={
        thread?.home.kind === "initiative" ? (
          // The Planner asks in the Initiative's planning Thread, read on the Initiative's page.
          <Link
            className="needs-you-place"
            to="/work/initiatives/$initiativeId"
            params={{ initiativeId: thread.home.initiativeId }}
            search={{ initiativeThread: thread.id }}
          >
            in the Initiative's planning Thread · {clockOf(decision.askedAt)}
          </Link>
        ) : (
          thread &&
          work && (
            // A Stage's Thread is read at its run, in the Stage history; any other in its person's tab.
            <Link
              className="needs-you-place"
              from="/tasks/$taskId"
              to="."
              search={(shown) => ({ ...shown, taskThread: work.runId ?? thread.id })}
              resetScroll={false}
              onClick={() => {
                if (work.runId === undefined) drawer.show();
              }}
            >
              in{" "}
              {work.runId === undefined
                ? `${card.personName}'s Thread`
                : chapterPlace(thread, work)}{" "}
              · {clockOf(decision.askedAt)}
            </Link>
          )
        )
      }
    />
  );
}

/** What the bar keeps in sight: the first Decision, else the Gate, else the Stand-in choice. */
function headlineOf(
  first: Decision | undefined,
  waiting: WaitingGate | undefined,
  standInChoice: boolean,
): string | undefined {
  if (first) return decisionSummary(first);
  if (waiting) return gateQuestion(waiting);
  return standInChoice ? STAND_IN_CHOICE_TITLE : undefined;
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
        <Badge tone="warning" size="sm">
          {count}
        </Badge>
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

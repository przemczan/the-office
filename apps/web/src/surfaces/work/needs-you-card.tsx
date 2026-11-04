import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import type { Decision, Task } from "@the-office/contracts";
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
import { waitingGateOf } from "../../shell/work/gate-words.ts";
import { needsYouSummary, nothingNeedsYouWords, waitingOnYou } from "./needs-you-words.ts";
import { RecordBlock } from "./record-block.tsx";
import { useInView } from "./use-in-view.ts";

/**
 * What waits on the user on this Task, under the rail and answered there (spec §4): its Decisions,
 * those with a Consultant marked and not counted. It says so when nothing waits.
 */
export function NeedsYouCard({ task }: { readonly task: Task }): ReactNode {
  const decisions = useQuery(decisionQueries.unanswered(task.id)).data;
  const taskStages = useQuery(pipelineQueries.taskStages(task.id)).data;
  if (!decisions || !taskStages) return null;
  if (decisions.length > 0) return <WaitingDecisions decisions={decisions} />;
  // The record's Gate block and Before Ready say what waits, until they move into this card.
  const atGate = taskStages.stages && waitingGateOf(taskStages.stages);
  if (task.state === "planning" || atGate) return null;
  return (
    <section className="needs-you-clear" aria-label="Needs you">
      <Icon name="check" size={14} />
      {nothingNeedsYouWords(task.state)}
    </section>
  );
}

function WaitingDecisions({ decisions }: { readonly decisions: readonly Decision[] }): ReactNode {
  const [card, setCard] = useState<HTMLElement | null>(null);
  const inView = useInView(card);
  const { decision: linkedTo } = useSearch({ from: "/tasks/$taskId" });
  useEffect(() => {
    if (linkedTo !== undefined) bringDecisionCardIntoView(linkedTo);
  }, [linkedTo]);
  const onYou = waitingOnYou(decisions);
  const first = onYou[0];
  return (
    <>
      {first && !inView && (
        <NeedsYouBar
          count={onYou.length}
          question={first.question}
          onShow={() => card?.scrollIntoView({ block: "start" })}
        />
      )}
      <div className="needs-you-card" ref={setCard}>
        <RecordBlock
          icon="hand"
          title="Needs you"
          actions={
            <span className="needs-you-summary">
              {onYou.length > 0 && <Badge tone="warning">{onYou.length}</Badge>}
              {needsYouSummary(decisions)}
            </span>
          }
        >
          <div className="needs-you-list">
            {decisions.map((decision) => (
              <WaitingDecision key={decision.id} decision={decision} />
            ))}
          </div>
        </RecordBlock>
      </div>
    </>
  );
}

function WaitingDecision({ decision }: { readonly decision: Decision }): ReactNode {
  const thread = useQuery(threadQueries.one(decision.threadId)).data;
  const roles = useQuery(roleQueries.list()).data;
  const personName = roles?.find(({ key }) => key === decision.roleKey)?.card.name ?? "The Office";
  return (
    <DecisionCard
      decision={decision}
      personName={personName}
      answering={thread?.state === "answering"}
      followUps={thread?.stageThread === false}
      place={
        thread && (
          <Link
            from="/tasks/$taskId"
            to="."
            search={(shown) => ({ ...shown, taskThread: thread.id })}
          >
            in {thread.title ?? "their Thread"} · {clockOf(decision.askedAt)}
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

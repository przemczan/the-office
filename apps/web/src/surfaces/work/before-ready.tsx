import { useQuery } from "@tanstack/react-query";
import type { Readiness, Task } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { decisionQueries } from "../../api/conversations.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { taskQueries } from "../../api/work.ts";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { NEEDS_YOU_ELEMENT_ID } from "./needs-you-words.ts";
import { PIPELINE_PROPOSAL_ELEMENT_ID } from "./pipeline-proposal.tsx";
import { bringIntoView, useShowRecordBlock, type PartBlock } from "./record-blocks.ts";
import { RecordBlock } from "./record-block.tsx";

type ReadinessPart = Readiness["lines"][number]["part"];

/**
 * What Mark Ready waits for, line by line, read-only: each unmet line says where it is settled and
 * links there. The lines come from the same Work rules that refuse Mark Ready.
 */
export function BeforeReady({ task }: { readonly task: Task }): ReactNode {
  const readiness = useQuery(taskQueries.readiness(task.id));
  return (
    <RecordBlock icon="list-checks" title="Before Ready">
      <ul className="task-checklist">
        {readiness.data?.lines.map(({ part, label, met }) => (
          <li key={part} className={met ? "task-checklist-met" : undefined}>
            <Icon name={met ? "check" : "circle"} size={14} />
            <div className="before-ready-line">
              <span>{label}</span>
              {!met && (
                <span className="task-quiet">
                  <WhereSettled part={part} task={task} />
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </RecordBlock>
  );
}

/** Where an unmet line is settled, from its `part`; the Task is read, as the line lags a refetch. */
function WhereSettled({
  part,
  task,
}: {
  readonly part: ReadinessPart;
  readonly task: Task;
}): ReactNode {
  switch (part) {
    case "plan":
      return (
        <OnBlock task={task} block="plan" written={task.plan !== ""}>
          on the Plan
        </OnBlock>
      );
    case "definition-of-done":
      return (
        <OnBlock task={task} block="definition-of-done" written={task.definitionOfDone.length > 0}>
          on the Definition of Done
        </OnBlock>
      );
    case "pipeline":
      return <OnRail task={task} />;
    case "decisions":
      return <InNeedsYou task={task} />;
  }
}

function OnBlock({
  task,
  block,
  written,
  children,
}: {
  readonly task: Task;
  readonly block: PartBlock;
  readonly written: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const showBlock = useShowRecordBlock(task.id);
  return (
    <>
      {written ? "Confirm it " : "Write it "}
      <LinkButton onClick={() => void showBlock(block)}>{children}</LinkButton>
    </>
  );
}

function OnRail({ task }: { readonly task: Task }): ReactNode {
  const planner = usePlanner()?.card.name ?? "The Planner";
  const pipelines = useQuery(pipelineQueries.list()).data;
  const proposed = task.proposedPipeline?.pipelineId;
  if (proposed === undefined) return null;
  const name = pipelines?.find(({ id }) => id === proposed)?.name ?? proposed;
  return (
    <>
      {planner} proposes {name} ·{" "}
      <LinkButton onClick={() => bringIntoView(PIPELINE_PROPOSAL_ELEMENT_ID)}>
        confirm it on the rail
      </LinkButton>
    </>
  );
}

function InNeedsYou({ task }: { readonly task: Task }): ReactNode {
  const open = useQuery(decisionQueries.unanswered(task.id)).data?.length ?? 0;
  return (
    <>
      {open} open,{" "}
      <LinkButton onClick={() => bringIntoView(NEEDS_YOU_ELEMENT_ID)}>in Needs you</LinkButton>
    </>
  );
}

function LinkButton({
  onClick,
  children,
}: {
  readonly onClick: () => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <button type="button" className="before-ready-link" onClick={onClick}>
      {children}
    </button>
  );
}

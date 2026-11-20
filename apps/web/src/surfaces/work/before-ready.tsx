import { useQuery } from "@tanstack/react-query";
import type { Readiness, Task } from "@the-office/contracts";
import { Icon, TextButton } from "@the-office/ui";
import type { ReactNode } from "react";
import { decisionQueries } from "../../api/conversations.ts";
import { projectQueries } from "../../api/projects.ts";
import { taskQueries } from "../../api/work.ts";
import {
  useEveryPipeline,
  useProjectPipelineChoices,
} from "../../shell/pipelines/use-pipelines.ts";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { KIND_PLURALS } from "../../shell/work/work-words.ts";
import { NEEDS_YOU_ELEMENT_ID } from "./needs-you-words.ts";
import { PIPELINE_PROPOSAL_ELEMENT_ID } from "./pipeline-proposal.tsx";
import { bringIntoView, useShowRecordBlock, type PartBlock } from "./record-blocks.ts";
import { RecordBlock } from "./record-block.tsx";
import { PIPELINE_RAIL_ELEMENT_ID } from "./stage-words.ts";

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
      <TextButton onClick={() => void showBlock(block)}>{children}</TextButton>
    </>
  );
}

function OnRail({ task }: { readonly task: Task }): ReactNode {
  const planner = usePlanner()?.card.name ?? "Whoever holds Plans";
  const pipelines = useEveryPipeline();
  const projectPipelines = useProjectPipelineChoices(task.projectId)?.projectPipelines;
  const brokenOne = (pipelineId: string | null | undefined) =>
    projectPipelines?.find(({ id, broken }) => id === pipelineId && broken.length > 0);
  const proposed = task.proposedPipeline?.pipelineId;
  const brokenProposed = brokenOne(proposed);
  const brokenCurrent = brokenOne(task.pipelineId);
  if (brokenProposed || (proposed === undefined && brokenCurrent)) {
    const broken = brokenProposed ?? brokenCurrent;
    return (
      <>
        {brokenProposed ? `${planner} proposes ${brokenProposed.name}` : broken?.name}, which is
        Broken ·{" "}
        <TextButton onClick={() => bringIntoView(PIPELINE_RAIL_ELEMENT_ID)}>
          choose another on the rail
        </TextButton>
      </>
    );
  }
  if (proposed === undefined)
    return task.pipelineId === null ? <ChooseAPipeline task={task} /> : null;
  const name = pipelines?.find(({ id }) => id === proposed)?.name ?? proposed;
  return (
    <>
      {planner} proposes {name} ·{" "}
      <TextButton onClick={() => bringIntoView(PIPELINE_PROPOSAL_ELEMENT_ID)}>
        confirm it on the rail
      </TextButton>
    </>
  );
}

/** No Pipeline and none proposed: the user chooses one in Backlog, the Planner proposes one in Planning. */
function ChooseAPipeline({ task }: { readonly task: Task }): ReactNode {
  const planner = usePlanner()?.card.name ?? "Whoever holds Plans";
  const project = useQuery(projectQueries.one(task.projectId)).data;
  const everyPipeline = useEveryPipeline();
  if (task.state !== "backlog") return `${planner} proposes one while planning`;
  const kindDefault = project?.kindDefaultPipelines[task.kind];
  const kindDefaultName = everyPipeline?.find(({ id }) => id === kindDefault)?.name;
  return (
    <>
      Choose a Pipeline{" "}
      <TextButton onClick={() => bringIntoView(PIPELINE_RAIL_ELEMENT_ID)}>on the rail</TextButton>
      {kindDefaultName !== undefined &&
        `: ${kindDefaultName} is the default for ${KIND_PLURALS[task.kind]}`}
    </>
  );
}

function InNeedsYou({ task }: { readonly task: Task }): ReactNode {
  const open = useQuery(decisionQueries.unanswered(task.id)).data?.length ?? 0;
  return (
    <>
      {open} open,{" "}
      <TextButton onClick={() => bringIntoView(NEEDS_YOU_ELEMENT_ID)}>in Needs you</TextButton>
    </>
  );
}

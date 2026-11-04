import type { Pipeline, Task } from "@the-office/contracts";
import type { ReactNode } from "react";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { NOT_STARTED } from "../../shell/work/work-words.ts";
import { DependenciesBlock } from "./dependencies-block.tsx";
import { DefinitionOfDoneBlock, PlanBlock, ProposedPipeline } from "./planning-parts.tsx";
import { OriginBlock } from "./origin-block.tsx";
import { ReadyBlock } from "./ready-block.tsx";
import { RecordBlock } from "./record-block.tsx";

/**
 * The Task's Overview: what must be true, how, the Pipeline proposed for it, its dependencies and
 * where it came from.
 */
export function TaskRecord({
  task,
  pipeline,
}: {
  readonly task: Task;
  readonly pipeline: Pipeline | undefined;
}): ReactNode {
  // It starts a sentence here.
  const planner = usePlanner()?.card.name ?? "The Planner";
  const proposing = NOT_STARTED.includes(task.state) && task.proposedPipeline !== null;
  return (
    <section className="task-record" aria-label="Record">
      <ReadyBlock task={task} />
      <DefinitionOfDoneBlock task={task} planner={planner} />
      <PlanBlock task={task} planner={planner} />
      {proposing && (
        <RecordBlock icon="route" title="Proposed Pipeline">
          <ProposedPipeline task={task} pipeline={pipeline} planner={planner} />
        </RecordBlock>
      )}
      <DependenciesBlock task={task} />
      <OriginBlock
        record={{ kind: "task", id: task.id }}
        ideaId={task.originIdeaId}
        initiativeId={task.initiativeId}
      />
    </section>
  );
}

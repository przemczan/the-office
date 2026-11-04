import type { Task } from "@the-office/contracts";
import type { ReactNode } from "react";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { DependenciesBlock } from "./dependencies-block.tsx";
import { DefinitionOfDoneBlock, PlanBlock } from "./planning-parts.tsx";
import { OriginBlock } from "./origin-block.tsx";

/** The Task's Overview: what must be true, how, its dependencies and where it came from. */
export function TaskRecord({ task }: { readonly task: Task }): ReactNode {
  // It starts a sentence here.
  const planner = usePlanner()?.card.name ?? "The Planner";
  return (
    <section className="task-record" aria-label="Record">
      <DefinitionOfDoneBlock task={task} planner={planner} />
      <PlanBlock task={task} planner={planner} />
      <DependenciesBlock task={task} />
      <OriginBlock
        record={{ kind: "task", id: task.id }}
        ideaId={task.originIdeaId}
        initiativeId={task.initiativeId}
      />
    </section>
  );
}

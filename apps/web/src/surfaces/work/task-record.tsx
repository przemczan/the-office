import type { Task } from "@the-office/contracts";
import type { ReactNode } from "react";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { CommitMessageBlock } from "./commit-message-block.tsx";
import { DescriptionBlock } from "./description-block.tsx";
import { DefinitionOfDoneBlock, PlanBlock } from "./planning-parts.tsx";

/**
 * The Task's Overview: what the user wants, with its Dependencies and Origin, how, the message of
 * the one commit it lands as, and what must be true.
 */
export function TaskRecord({ task }: { readonly task: Task }): ReactNode {
  // It starts a sentence here.
  const planner = usePlanner()?.card.name ?? "Whoever holds Plans";
  return (
    <section className="task-record" aria-label="Record">
      <DescriptionBlock task={task} />
      <PlanBlock task={task} planner={planner} />
      <CommitMessageBlock task={task} />
      <DefinitionOfDoneBlock task={task} planner={planner} />
    </section>
  );
}

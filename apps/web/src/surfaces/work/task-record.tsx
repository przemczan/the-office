import type { Task } from "@the-office/contracts";
import type { ReactNode } from "react";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { CommitMessageBlock } from "./commit-message-block.tsx";
import { DescriptionBlock } from "./description-block.tsx";
import { DevicesBlock } from "./devices-block.tsx";
import { HistoryBlock } from "./history-block.tsx";
import { DefinitionOfDoneBlock, PlanBlock } from "./planning-parts.tsx";
import { TaskEngineBlock } from "./work-engine-block.tsx";

/**
 * The Task's Overview: what the user wants, with its Dependencies and Origin, how, the message of
 * the one commit it lands as, what must be true, what it runs on, and the devices its run
 * environment reaches.
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
      <TaskEngineBlock task={task} />
      <DevicesBlock task={task} />
      <HistoryBlock record={{ kind: "task", id: task.id }} />
    </section>
  );
}

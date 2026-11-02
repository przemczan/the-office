import { useQuery } from "@tanstack/react-query";
import type { Task } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { taskQueries } from "../../api/work.ts";
import { UsageEstimateLine } from "../../shell/work/usage-estimate-line.tsx";
import { RecordBlock } from "./record-block.tsx";

/**
 * What Mark Ready waits for, line by line, on a Task in Planning; on a Ready Task, that starting it
 * is the user's call, with its Usage estimate. The lines come from the same Work rules that refuse Mark Ready.
 */
export function ReadyBlock({ task }: { readonly task: Task }): ReactNode {
  if (task.state === "planning") return <BeforeReady task={task} />;
  if (task.state !== "ready") return null;
  return <WhenReady task={task} />;
}

/** The Usage estimate Start weighs, from the same start check as Start beside it. */
function WhenReady({ task }: { readonly task: Task }): ReactNode {
  const check = useQuery(taskQueries.startCheck(task.id));
  return (
    <RecordBlock icon="circle-check" title="Ready">
      <p className="task-quiet">Ready: start it when you want; nothing starts by itself.</p>
      <UsageEstimateLine estimate={check.data?.usageEstimate} />
    </RecordBlock>
  );
}

function BeforeReady({ task }: { readonly task: Task }): ReactNode {
  const readiness = useQuery(taskQueries.readiness(task.id));
  return (
    <RecordBlock icon="list-checks" title="Before Ready">
      <ul className="task-checklist">
        {readiness.data?.lines.map(({ label, met, problems }) => (
          <li key={label} className={met ? "task-checklist-met" : undefined}>
            <Icon name={met ? "check" : "circle"} size={14} />
            <span>
              {label}
              {!met && <span className="task-quiet"> · {problems.join(" ")}</span>}
            </span>
          </li>
        ))}
      </ul>
    </RecordBlock>
  );
}

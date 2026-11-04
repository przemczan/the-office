import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Role, Task, TaskChanges, TaskStages } from "@the-office/contracts";
import { Badge } from "@the-office/ui";
import type { ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { attachmentQueries } from "../../api/work.ts";
import { CardAttachments, CardColumns } from "../../shell/attachments/card-attachments.tsx";
import { clockOf } from "../../shell/time.ts";
import { GateActions } from "../../shell/work/gate-actions.tsx";
import type { WaitingGate } from "../../shell/work/gate-words.ts";
import {
  definitionOfDoneFact,
  gateQuestion,
  linesChanged,
  picturesOfThisRound,
  testsBeforeGate,
  testsFact,
} from "./gate-card-words.ts";
import { RECORD_ELEMENT_ID } from "./record-tab.ts";

/**
 * The Gate the Task waits at, in the Needs you card (spec §4): what the work came to in four facts
 * and the pictures of this round, beside Continue, Send back and Drop. The rest is elsewhere on the
 * page: the Stages' results on the rail, the diff and each test's result in Changes, the other
 * Attachments in their tab.
 */
export function GateCard({
  task,
  taskStages,
  waiting,
  roles,
}: {
  readonly task: Task;
  readonly taskStages: TaskStages;
  readonly waiting: WaitingGate;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const stages = taskStages.stages ?? [];
  const attachments = useQuery(attachmentQueries.of({ kind: "task", taskId: task.id })).data;
  const pictures = picturesOfThisRound(attachments ?? [], stages);
  const reachedAt = stages
    .find(({ stage }) => stage.key === waiting.gate.key)
    ?.runs.at(-1)?.startedAt;
  return (
    <section className="message needs-you-gate" aria-label={`Gate · ${waiting.gate.name}`}>
      <CardColumns
        side={
          <>
            <GateFacts task={task} taskStages={taskStages} waiting={waiting} />
            {pictures.length > 0 && <CardAttachments title="Screenshots" attachments={pictures} />}
          </>
        }
      >
        <div className="message-by">
          <Badge tone="info">Gate</Badge>
          {waiting.gate.name}
          {reachedAt !== undefined && <span className="gate-place">{clockOf(reachedAt)}</span>}
        </div>
        <div className="message-text gate-question">{gateQuestion(waiting)}</div>
        <GateActions task={task} waiting={waiting} roles={roles} alongside={<OpenChanges />} />
      </CardColumns>
    </section>
  );
}

function GateFacts({
  task,
  taskStages,
  waiting,
}: {
  readonly task: Task;
  readonly taskStages: TaskStages;
  readonly waiting: WaitingGate;
}): ReactNode {
  const changes = useQuery(projectQueries.taskChanges(task.projectId, task.id)).data;
  const checks = testsBeforeGate(taskStages.testResults, taskStages.stages ?? [], waiting);
  return (
    <dl className="gate-facts">
      <GateFact label="Files changed">{changes?.files.length ?? "–"}</GateFact>
      <GateFact label="Lines">{changes ? <LinesFact changes={changes} /> : "–"}</GateFact>
      <GateFact label="Tests" failed={checks.some(({ state }) => state === "failed")}>
        {testsFact(checks)}
      </GateFact>
      <GateFact label="Definition of Done">
        {definitionOfDoneFact(task, taskStages.definitionOfDoneMet)}
      </GateFact>
    </dl>
  );
}

function GateFact({
  label,
  failed = false,
  children,
}: {
  readonly label: string;
  readonly failed?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className={`gate-fact${failed ? " gate-fact-failed" : ""}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function LinesFact({ changes }: { readonly changes: TaskChanges }): ReactNode {
  const { added, removed } = linesChanged(changes.files);
  return (
    <>
      <span className="changes-added">+{added}</span>{" "}
      <span className="changes-removed">−{removed}</span>
    </>
  );
}

/** The Changes tab, brought into view: the card may have pushed it below the fold. */
function OpenChanges(): ReactNode {
  return (
    <Link
      className="link-button"
      from="/tasks/$taskId"
      to="."
      search={(shown) => ({ ...shown, recordTab: "changes" })}
      onClick={() => {
        document.getElementById(RECORD_ELEMENT_ID)?.scrollIntoView({ block: "start" });
      }}
    >
      Open Changes
    </Link>
  );
}

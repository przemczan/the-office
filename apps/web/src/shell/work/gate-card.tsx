import { useQuery } from "@tanstack/react-query";
import type { Role, Task, TaskStages } from "@the-office/contracts";
import { Badge, Button } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { clockOf } from "../time.ts";
import { ContinueRefused, useContinuingAtGate } from "./gate-actions.tsx";
import {
  continueAtGateLabel,
  definitionOfDoneFact,
  gateFactsLine,
  gateHeading,
  gateQuestion,
  testsBeforeGate,
  unmetAtTheCheck,
} from "./gate-card-words.ts";
import { GateUnmetStatements } from "./gate-unmet-statements.tsx";
import { GateWindow } from "./gate-window.tsx";
import type { WaitingGate } from "./gate-words.ts";
import "./gate.css";

/**
 * The Gate a Task waits at, in the Task's Needs you card, on Now and in the Needs you panel (spec
 * §4): what it waits for, a line of its facts, Continue and Show details. Everything else at the
 * Gate is in its window.
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const continuing = useContinuingAtGate(task, waiting);
  const changes = useQuery(projectQueries.taskChanges(task.projectId, task.id)).data;
  const stages = taskStages.stages ?? [];
  const reachedAt = stages
    .find(({ stage }) => stage.key === waiting.gate.key)
    ?.runs.at(-1)?.startedAt;
  const unmet = unmetAtTheCheck(task, taskStages, waiting);
  return (
    <section className="message gate-card" aria-label={`Gate · ${waiting.gate.name}`}>
      <div className="message-by">
        <Badge tone="accent">Gate</Badge>
        {gateHeading(waiting)}
        {reachedAt !== undefined && <span className="needs-you-time">{clockOf(reachedAt)}</span>}
      </div>
      <div className="message-text gate-question">{gateQuestion(waiting)}</div>
      <p className="gate-facts-line">
        {gateFactsLine(
          changes?.files.length,
          testsBeforeGate(taskStages.testResults, stages, waiting),
          definitionOfDoneFact(task, taskStages.definitionOfDoneMet),
        )}
      </p>
      <GateUnmetStatements unmet={unmet} />
      <div className="gate-actions">
        <Button
          variant="accent"
          loading={continuing.isPending}
          disabled={continuing.isPending}
          onClick={() => continuing.mutate()}
        >
          {continueAtGateLabel(waiting, unmet)}
        </Button>
        <Button variant="secondary" onClick={() => setDetailsOpen(true)}>
          Show details
        </Button>
      </div>
      {continuing.error && <ContinueRefused error={continuing.error} />}
      {detailsOpen && (
        <GateWindow
          task={task}
          taskStages={taskStages}
          waiting={waiting}
          roles={roles}
          onClose={() => setDetailsOpen(false)}
        />
      )}
    </section>
  );
}

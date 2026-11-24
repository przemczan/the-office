import { Link } from "@tanstack/react-router";
import type { ActionRun } from "@the-office/contracts";
import { Card, DataTable, Icon, type DataTableColumn } from "@the-office/ui";
import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { shortCommit } from "../../../shell/test-instances/test-instance-words.ts";
import { momentWords } from "../../../shell/time.ts";
import { useSignedInUserId } from "../../../shell/use-user-name.ts";
import { ActionRunStateBadge } from "./action-run-parts.tsx";
import {
  HISTORY_EMPTY,
  HISTORY_FOOT,
  ranFromWords,
  startedByWords,
  tookWords,
} from "./action-run-words.ts";

/** A link inside a row opens its own page, not the row's log. */
function keepToItself(event: MouseEvent): void {
  event.stopPropagation();
}

/**
 * The open Action's History card (screens/project-page.md, "History"): its runs, newest first, a
 * row each; a press on a row, or on its state, opens its log. The run the address names
 * (`?run=<id>`) is brought into view once listed.
 */
export function ActionHistory({
  projectId,
  runs,
  shownRunId,
  onOpenRun,
}: {
  readonly projectId: string;
  readonly runs: readonly ActionRun[];
  readonly shownRunId: string | undefined;
  readonly onOpenRun: (run: ActionRun) => void;
}): ReactNode {
  const signedInUserId = useSignedInUserId();
  const place = useRef<HTMLDivElement>(null);
  const brought = useRef<string>(undefined);
  // On every render, as the run may be listed only once the runs are read again.
  useEffect(() => {
    if (shownRunId === undefined || brought.current === shownRunId) return;
    const cell = [...(place.current?.querySelectorAll<HTMLElement>("[data-run]") ?? [])].find(
      ({ dataset }) => dataset["run"] === shownRunId,
    );
    if (!cell) return;
    brought.current = shownRunId;
    (cell.closest("tr") ?? cell).scrollIntoView({ block: "center" });
  });
  const columns: DataTableColumn<ActionRun>[] = [
    {
      key: "state",
      header: "State",
      render: (run) => (
        <button
          type="button"
          className="action-history-open"
          data-run={run.id}
          aria-label={`Open the log of the run started ${momentWords(run.startedAt)}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenRun(run);
          }}
        >
          <ActionRunStateBadge run={run} />
        </button>
      ),
    },
    {
      key: "from",
      header: "Ran from",
      wrap: true,
      render: (run) => <RanFrom run={run} />,
    },
    {
      key: "commit",
      header: "Commit",
      mono: true,
      render: (run) => shortCommit(run.commit) ?? "",
    },
    {
      key: "started",
      header: "Started",
      render: (run) => `${startedByWords(run, signedInUserId)} · ${momentWords(run.startedAt)}`,
    },
    { key: "took", header: "Took", render: (run) => tookWords(run) },
    {
      key: "why",
      header: "Why",
      wrap: true,
      muted: true,
      render: (run) =>
        run.outcome === "failed" || run.outcome === "stopped" ? (run.endedBecause ?? "") : "",
    },
    {
      key: "link",
      header: "",
      render: (run) => <RunLink projectId={projectId} run={run} />,
    },
  ];
  return (
    <Card title="History" footer={HISTORY_FOOT}>
      <div ref={place} className="action-history">
        {runs.length === 0 ? (
          <p className="project-block-text">{HISTORY_EMPTY}</p>
        ) : (
          <DataTable
            columns={columns}
            rows={[...runs]}
            density="compact"
            onRowClick={(run) => onOpenRun(run)}
          />
        )}
      </div>
    </Card>
  );
}

/** The branch in monospace, or the Task's title or the Initiative's name, linked, with its branch. */
function RanFrom({ run }: { readonly run: ActionRun }): ReactNode {
  const { ranFrom } = run;
  const branch = <code>{run.branch}</code>;
  switch (ranFrom.kind) {
    case "branch":
      return branch;
    case "task":
      return (
        <span className="action-history-from">
          <Link to="/tasks/$taskId" params={{ taskId: ranFrom.taskId }} onClick={keepToItself}>
            {ranFromWords(run)}
          </Link>
          {branch}
        </span>
      );
    case "initiative":
      return (
        <span className="action-history-from">
          <Link
            to="/work/initiatives/$initiativeId"
            params={{ initiativeId: ranFrom.initiativeId }}
            onClick={keepToItself}
          >
            {ranFromWords(run)}
          </Link>
          {branch}
        </span>
      );
  }
}

/**
 * A Test target run's "Test instance", in Test instances; a Workflow run's "<workflow> #<number>"
 * on the code host, or its Workflow's runs while its CI run didn't show.
 */
function RunLink({
  projectId,
  run,
}: {
  readonly projectId: string;
  readonly run: ActionRun;
}): ReactNode {
  if (run.testInstanceId !== null) {
    return (
      <Link
        to="/projects/$projectId/test-targets"
        params={{ projectId }}
        search={{ testInstance: run.testInstanceId }}
        onClick={keepToItself}
      >
        Test instance
      </Link>
    );
  }
  const url = run.ciRun?.url ?? run.workflowRunsUrl;
  if (url === null || url === undefined) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" onClick={keepToItself}>
      {run.ciRun ? `${run.ciRun.workflowName} #${run.ciRun.number}` : "Its runs"}
      <Icon name="external-link" size={12} />
    </a>
  );
}

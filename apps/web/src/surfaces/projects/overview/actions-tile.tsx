import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Action, Project } from "@the-office/contracts";
import { useState, type ReactNode } from "react";
import { actionRunQueries } from "../../../api/action-runs.ts";
import { actionQueries } from "../../../api/actions.ts";
import { LeavesTheWorkstationBadge } from "../actions/action-parts.tsx";
import { ActionRunStateBadge, RunActionButton } from "../actions/action-run-parts.tsx";
import { lastRunOf, moreUnderActionsWords, NO_ACTIONS_TILE } from "../actions/action-run-words.ts";
import { RunWindow } from "../actions/run-window.tsx";
import { OverviewTile, TileEmpty } from "./overview-tile.tsx";

/** How many of the Project's Actions the tile names. */
const SHOWN_ACTIONS = 5;

/**
 * The Actions tile (screens/project-page.md, "Actions tile"): up to 5 of the Project's Actions in
 * the Actions section's order, each with its last run's state and Run, which opens the Run window.
 */
export function ActionsTile({ project }: { readonly project: Project }): ReactNode {
  const actions = useQuery(actionQueries.list(project.id));
  const runs = useQuery(actionRunQueries.ofProject(project.id));
  const [running, setRunning] = useState<Action>();
  const toActions = (children: string, className?: string): ReactNode => (
    <Link
      to="/projects/$projectId/actions"
      params={{ projectId: project.id }}
      className={className}
    >
      {children}
    </Link>
  );
  return (
    <OverviewTile
      icon="play"
      title="Actions"
      link={toActions("All Actions", "project-block-link")}
      readings={[actions, runs]}
    >
      {() => {
        const all = actions.data?.actions ?? [];
        if (all.length === 0) {
          return (
            <TileEmpty>
              {NO_ACTIONS_TILE} {toActions("Add one under Actions")}
            </TileEmpty>
          );
        }
        const more = all.length - SHOWN_ACTIONS;
        return (
          <>
            <ul className="project-overview-list" aria-label={`${project.name}'s Actions`}>
              {all.slice(0, SHOWN_ACTIONS).map((action) => {
                const lastRun = lastRunOf(runs.data, action.key);
                return (
                  <li key={action.key} className="project-overview-row">
                    <span className="project-overview-row">
                      <Link
                        to="/projects/$projectId/actions/$actionKey"
                        params={{ projectId: project.id, actionKey: action.key }}
                        className="project-overview-name"
                      >
                        {action.name}
                      </Link>
                      {action.leavesTheWorkstation && (
                        <LeavesTheWorkstationBadge baseBranch={project.baseBranch} />
                      )}
                      <ActionRunStateBadge run={lastRun} />
                    </span>
                    <RunActionButton
                      action={action}
                      runEnvironment={project.runEnvironment}
                      lastRun={lastRun}
                      onRun={() => setRunning(action)}
                    />
                  </li>
                );
              })}
            </ul>
            {more > 0 && (
              <p className="project-overview-empty">{toActions(moreUnderActionsWords(more))}</p>
            )}
            {running && (
              <RunWindow project={project} action={running} onClose={() => setRunning(undefined)} />
            )}
          </>
        );
      }}
    </OverviewTile>
  );
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Project, ProjectTestInstances, TestInstance } from "@the-office/contracts";
import { Badge, Button } from "@the-office/ui";
import type { ReactNode } from "react";
import { projectQueries } from "../../../api/projects.ts";
import { testInstanceQueries } from "../../../api/test-instances.ts";
import { checkedWords } from "../../../shell/code-host-words.ts";
import { TestInstanceStateBadge } from "../../../shell/test-instances/test-target-launch-row.tsx";
import {
  useTestInstanceActions,
  type TestInstanceActions,
} from "../../../shell/test-instances/use-test-instance-actions.ts";
import { checkBadge } from "../environment-labels.ts";
import { OverviewTile, TileEmpty } from "./overview-tile.tsx";
import { activeTestInstances, firstFailedStep } from "./overview-words.ts";

/** The Project's Building and Running test instances on every branch, a Running Hosted one with Open. */
export function TestInstancesTile({ project }: { readonly project: Project }): ReactNode {
  const query = testInstanceQueries.ofProject(project.id);
  const testInstances = useQuery(query);
  const queryClient = useQueryClient();
  const actions = useTestInstanceActions({
    readOnly: false,
    readAgain: () => queryClient.invalidateQueries({ queryKey: query.queryKey }),
    // The tile offers no QR code; a Built instance's files are on the Test targets tab.
    showLink: () => undefined,
  });
  return (
    <OverviewTile
      icon="flask-conical"
      title="Test instances"
      link={
        <Link
          to="/projects/$projectId/test-targets"
          params={{ projectId: project.id }}
          className="project-block-link"
        >
          Test targets
        </Link>
      }
      readings={[testInstances]}
    >
      {() => {
        if (testInstances.data === undefined) return null;
        const active = activeTestInstances(testInstances.data);
        if (active.length === 0) return <TileEmpty>None running.</TileEmpty>;
        return (
          <ul className="project-overview-list">
            {active.map((instance) => (
              <TestInstanceRow
                key={instance.id}
                instance={instance}
                initiatives={testInstances.data.initiatives}
                actions={actions}
              />
            ))}
          </ul>
        );
      }}
    </OverviewTile>
  );
}

function TestInstanceRow({
  instance,
  initiatives,
  actions,
}: {
  readonly instance: TestInstance;
  readonly initiatives: ProjectTestInstances["initiatives"];
  readonly actions: Omit<TestInstanceActions, "showLog">;
}): ReactNode {
  const initiative = initiatives.find(({ id }) => id === instance.initiativeId);
  return (
    <li className="project-overview-test-instance">
      <span className="project-overview-row">
        <span className="project-overview-name">{instance.targetName}</span>
        <TestInstanceStateBadge instance={instance} />
        {instance.kind === "hosted" && instance.state === "running" && (
          <Button size="sm" variant="secondary" onClick={() => actions.open(instance)}>
            Open
          </Button>
        )}
      </span>
      <span className="project-overview-age">
        <span className="project-path">{instance.branch}</span>
        {initiative !== undefined && (
          <>
            {" · "}
            <Link to="/work/initiatives/$initiativeId" params={{ initiativeId: initiative.id }}>
              {initiative.name}
            </Link>
          </>
        )}
      </span>
    </li>
  );
}

/** How the Project's last environment check went, with its first failed step. */
export function EnvironmentTile({ project }: { readonly project: Project }): ReactNode {
  const check = useQuery(projectQueries.environmentCheck(project.id));
  return (
    <OverviewTile
      icon="shield-check"
      title="Environment"
      link={
        <Link
          to="/projects/$projectId/environment"
          params={{ projectId: project.id }}
          className="project-block-link"
        >
          Environment
        </Link>
      }
      readings={[check]}
    >
      {() => {
        if (check.data === null || check.data === undefined) {
          return <TileEmpty>Not checked yet.</TileEmpty>;
        }
        const badge = checkBadge(check.data);
        const failedStep = firstFailedStep(check.data, project);
        return (
          <>
            <p className="project-overview-row">
              <Badge tone={badge.tone} dot size="sm">
                {badge.label}
              </Badge>
              <span className="project-overview-age">
                {checkedWords(check.data.finishedAt ?? check.data.startedAt)}
              </span>
            </p>
            {failedStep !== undefined && (
              <p className="project-overview-warning">Failed at: {failedStep}</p>
            )}
          </>
        );
      }}
    </OverviewTile>
  );
}

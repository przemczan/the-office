import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  initiativeBranchOf,
  type Initiative,
  type InitiativeTestInstancesProject,
  type Project,
  type TestInstance,
} from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { launchTestInstance, testInstanceQueries } from "../../api/test-instances.ts";
import { BlockLoaderOrProblem } from "../../shell/block-loader.tsx";
import { ProjectMark } from "../../shell/project-mark.tsx";
import {
  TestBuildQrDialog,
  type ShownTestBuildLink,
} from "../../shell/test-instances/test-build-qr-dialog.tsx";
import { TestInstanceLogWindow } from "../../shell/test-instances/test-instance-log-window.tsx";
import { needsRunEnvironment } from "../../shell/test-instances/test-instance-words.ts";
import {
  NeedsRunEnvironmentNote,
  TestTargetLaunchRow,
} from "../../shell/test-instances/test-target-launch-row.tsx";
import {
  useTestInstanceActions,
  type TestInstanceActions,
} from "../../shell/test-instances/use-test-instance-actions.ts";
import {
  FILES_REMOVED_LATER,
  NO_INITIATIVE_BRANCH,
  noTestTargetsWords,
  shownTargetsOf,
  testInstancesFoot,
  testInstancesReadOnly,
  testInstancesShown,
  testInstancesStartOpen,
  testInstancesSummary,
} from "./initiative-test-instances-words.ts";
import { RecordFold } from "./record-fold.tsx";
import { useFold } from "./record-folds.ts";

/**
 * The Initiative page's Test instances (spec screens/initiative-page.md, "Test instances";
 * docs/design/test-instances.html): once the Initiative is confirmed, a group per Project on its
 * branch with a row per Hosted or Build to install test target, its newest instance and the earlier
 * ones folded under it. Launch, Stop, Open and Log act from the row, and a Built instance's files
 * each have Download and a QR code; Done or Dropped, it is read-only.
 */
export function InitiativeTestInstancesBlock({
  initiative,
  projects,
}: {
  readonly initiative: Initiative;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  return testInstancesShown(initiative) ? (
    <TestInstancesFold initiative={initiative} projects={projects} />
  ) : null;
}

function TestInstancesFold({
  initiative,
  projects,
}: {
  readonly initiative: Initiative;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const query = useQuery(testInstanceQueries.ofInitiative(initiative.id));
  const groups = query.data?.projects;
  const fold = useFold(
    { kind: "initiative", id: initiative.id },
    "test-instances",
    testInstancesStartOpen(groups),
  );
  const [qrShown, setQrShown] = useState<ShownTestBuildLink>();
  const queryClient = useQueryClient();
  const actions = useTestInstanceActions({
    readOnly: testInstancesReadOnly(initiative),
    readAgain: () =>
      queryClient.invalidateQueries({
        queryKey: testInstanceQueries.ofInitiative(initiative.id).queryKey,
      }),
    showLink: setQrShown,
  });
  const [logShown, setLogShown] = useState<string>();
  const projectOf = (projectId: string): Project | undefined =>
    projects?.find(({ id }) => id === projectId);
  const shownInstance = logShown === undefined ? undefined : findInstance(groups, logShown);
  const branch =
    initiative.shortName === null ? undefined : initiativeBranchOf(initiative.shortName);
  const withLog: TestInstanceActions = {
    ...actions,
    showLog: (instance) => setLogShown(instance.id),
  };
  return (
    <RecordFold
      fold={fold}
      icon="flask-conical"
      title="Test instances"
      summary={testInstancesSummary(groups)}
    >
      {groups === undefined ? (
        <BlockLoaderOrProblem shape="rows" count={2} reads={[query]} />
      ) : groups.length === 0 ? (
        <p className="task-quiet">{NO_INITIATIVE_BRANCH}</p>
      ) : (
        <div className="test-instances">
          {groups.map((group) => (
            <ProjectGroup
              key={group.projectId}
              group={group}
              project={projectOf(group.projectId)}
              initiativeId={initiative.id}
              branch={branch}
              actions={withLog}
            />
          ))}
          <p className="test-instances-foot">{testInstancesFoot(initiative)}</p>
        </div>
      )}
      {shownInstance && (
        <TestInstanceLogWindow
          instance={shownInstance}
          project={projectOf(shownInstance.projectId)}
          projectName={projectOf(shownInstance.projectId)?.name ?? shownInstance.projectId}
          branch={branch}
          stopping={actions.stoppingId === shownInstance.id}
          onOpen={() => actions.open(shownInstance)}
          onStop={() => actions.stop(shownInstance)}
          onClose={() => setLogShown(undefined)}
        />
      )}
      {qrShown && <TestBuildQrDialog shown={qrShown} onClose={() => setQrShown(undefined)} />}
    </RecordFold>
  );
}

function findInstance(
  groups: readonly InitiativeTestInstancesProject[] | undefined,
  instanceId: string,
): TestInstance | undefined {
  return groups
    ?.flatMap(({ targets }) => targets.flatMap(({ instances }) => instances))
    .find(({ id }) => id === instanceId);
}

/** One Project's group: its mark and name, then a row per test target or why there are none. */
function ProjectGroup({
  group,
  project,
  initiativeId,
  branch,
  actions,
}: {
  readonly group: InitiativeTestInstancesProject;
  readonly initiativeId: string;
  readonly project: Project | undefined;
  readonly branch: string | undefined;
  readonly actions: TestInstanceActions;
}): ReactNode {
  const projectName = project?.name ?? group.projectId;
  const targets = shownTargetsOf(group);
  return (
    <section className="test-instances-project" aria-label={projectName}>
      <div className="test-instances-project-head">
        <span className="test-instances-project-name">
          {project && <ProjectMark project={project} />}
          {projectName}
        </span>
        {branch !== undefined && (
          <span className="test-instances-branch">
            <Icon name="git-branch" size={12} />
            <code>{branch}</code>
          </span>
        )}
      </div>
      {targets.length === 0 ? (
        <p className="test-instances-empty">
          {noTestTargetsWords(projectName)}{" "}
          <Link to="/projects/$projectId/test-targets" params={{ projectId: group.projectId }}>
            Add them in its Test targets section
          </Link>
          .
        </p>
      ) : (
        <>
          {!group.runEnvironmentOn && !actions.readOnly && targets.some(needsRunEnvironment) && (
            <NeedsRunEnvironmentNote projectId={group.projectId} projectName={projectName} />
          )}
          <ul className="test-instances-targets" aria-label={`Test targets in ${projectName}`}>
            {targets.map((target) => (
              <TestTargetLaunchRow
                key={target.key}
                projectName={projectName}
                runEnvironmentOn={group.runEnvironmentOn}
                branchCommit={group.branchCommit}
                target={target}
                instances={target.instances}
                launchKey={`${group.projectId}-${target.key}`}
                onLaunch={() =>
                  actions.launch({
                    key: `${group.projectId}-${target.key}`,
                    targetName: target.name,
                    send: () =>
                      launchTestInstance(initiativeId, {
                        projectId: group.projectId,
                        targetKey: target.key,
                      }),
                  })
                }
                actions={actions}
                filesNote={actions.readOnly ? FILES_REMOVED_LATER : undefined}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

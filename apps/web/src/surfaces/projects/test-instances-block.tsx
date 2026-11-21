import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type {
  LaunchableTestTarget,
  Project,
  ProjectTestBranch,
  ProjectTestInstances,
  TestInstance,
} from "@the-office/contracts";
import { Badge, GroupedSelect, Icon, type GroupedSelectGroup } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { launchOnBranch, testInstanceQueries } from "../../api/test-instances.ts";
import { BlockLoaderOrProblem } from "../../shell/block-loader.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
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
import { ProjectBlock } from "./project-block.tsx";
import { TEST_TARGETS_ANCHOR } from "./test-targets-block.tsx";
import {
  branchChoicesOf,
  firstBranchOf,
  LAUNCH_FOOT,
  nothingToLaunchWords,
  OTHER_BRANCHES,
  TEST_INSTANCES_NOTE,
} from "./test-instances-words.ts";

/**
 * A Project's Test instances, under its Test targets: the Branch picker and a row per Hosted or
 * Build to install test target on the branch picked, as the Initiative page's rows, launching on
 * that branch; then the other branches launched on, each with its instances, the earlier folded.
 * An instance linked to an Initiative says so, linking to its page.
 */
export function TestInstancesBlock({ project }: { readonly project: Project }): ReactNode {
  const query = useQuery(testInstanceQueries.ofProject(project.id));
  const shown = query.data;
  return (
    <ProjectBlock icon="flask-conical" title="Test instances">
      <p className="project-block-text">{TEST_INSTANCES_NOTE}</p>
      {shown === undefined ? (
        <BlockLoaderOrProblem shape="rows" count={2} reads={[query]} />
      ) : shown.targets.length === 0 ? (
        <p className="project-block-note">
          {nothingToLaunchWords(project.name)}{" "}
          <Link
            to="/projects/$projectId/test-targets"
            params={{ projectId: project.id }}
            hash={TEST_TARGETS_ANCHOR}
          >
            Add one under Test targets
          </Link>
          .
        </p>
      ) : (
        <Launchable project={project} shown={shown} />
      )}
    </ProjectBlock>
  );
}

function Launchable({
  project,
  shown,
}: {
  readonly project: Project;
  readonly shown: ProjectTestInstances;
}): ReactNode {
  const [picked, setPicked] = useState<string>();
  const branch = picked ?? firstBranchOf(shown, project.baseBranch);
  const [qrShown, setQrShown] = useState<ShownTestBuildLink>();
  const [logShown, setLogShown] = useState<string>();
  const queryClient = useQueryClient();
  const actions = useTestInstanceActions({
    readOnly: false,
    readAgain: () =>
      queryClient.invalidateQueries({
        queryKey: testInstanceQueries.ofProject(project.id).queryKey,
      }),
    showLink: setQrShown,
  });
  const withLog: TestInstanceActions = {
    ...actions,
    showLog: (instance) => setLogShown(instance.id),
  };
  const shownInstance =
    logShown === undefined
      ? undefined
      : shown.branches.flatMap(({ instances }) => instances).find(({ id }) => id === logShown);
  const pickedBranch = shown.branches.find(({ name }) => name === branch) ?? {
    name: branch,
    branchCommit: null,
    instances: [],
  };
  const others = shown.branches.filter(
    ({ name, instances }) => name !== branch && instances.length > 0,
  );
  const group = (testBranch: ProjectTestBranch, launchedOnly: boolean): ReactNode => (
    <BranchGroup
      key={testBranch.name}
      project={project}
      shown={shown}
      testBranch={testBranch}
      launchedOnly={launchedOnly}
      actions={withLog}
    />
  );
  return (
    <div className="test-instances project-test-instances">
      <BranchPicker
        project={project}
        launchedOn={shown.branches.map(({ name }) => name)}
        branch={branch}
        onPick={setPicked}
      />
      {!shown.runEnvironmentOn && shown.targets.some(needsRunEnvironment) && (
        <NeedsRunEnvironmentNote projectId={project.id} projectName={project.name} />
      )}
      {group(pickedBranch, false)}
      {others.length > 0 && (
        <section className="project-test-instances-others" aria-label={OTHER_BRANCHES}>
          <h4 className="project-test-instances-heading">{OTHER_BRANCHES}</h4>
          {others.map((other) => group(other, true))}
        </section>
      )}
      <p className="test-instances-foot">{LAUNCH_FOOT}</p>
      {shownInstance && (
        <TestInstanceLogWindow
          instance={shownInstance}
          project={project}
          projectName={project.name}
          branch={shownInstance.branch}
          stopping={actions.stoppingId === shownInstance.id}
          onOpen={() => actions.open(shownInstance)}
          onStop={() => actions.stop(shownInstance)}
          onClose={() => setLogShown(undefined)}
        />
      )}
      {qrShown && <TestBuildQrDialog shown={qrShown} onClose={() => setQrShown(undefined)} />}
    </div>
  );
}

/**
 * The Branch picker: the base branch first, then the others by name. The Project's branches are
 * fetched only once it is opened, so until then it offers the branches launched on.
 */
function BranchPicker({
  project,
  launchedOn,
  branch,
  onPick,
}: {
  readonly project: Project;
  readonly launchedOn: readonly string[];
  readonly branch: string;
  readonly onPick: (branch: string) => void;
}): ReactNode {
  const [opened, setOpened] = useState(false);
  const branches = useQuery({
    ...projectQueries.branches(project.id, { fetch: true }),
    enabled: opened,
  });
  const choices = branchChoicesOf(project.baseBranch, branches.data, [...launchedOn, branch]);
  const groups: GroupedSelectGroup[] = [
    {
      label: "Base branch",
      options: [
        {
          value: choices.baseBranch,
          label: choices.baseBranch,
          aside: <Badge tone="neutral">base branch</Badge>,
        },
      ],
    },
    {
      label: "Branches",
      options: choices.others.map((name) => ({ value: name, label: name })),
    },
  ];
  return (
    <div
      className="project-test-instances-branch"
      onPointerDownCapture={() => setOpened(true)}
      onFocusCapture={() => setOpened(true)}
      onClickCapture={() => setOpened(true)}
    >
      <GroupedSelect
        label="Branch"
        size="sm"
        value={branch}
        groups={groups}
        hint={branches.isFetching ? "Fetching branches…" : undefined}
        onChange={onPick}
      />
      {branches.error && <RefusalAlert title="The branches can't be read" error={branches.error} />}
      {branches.data?.fetchProblem != null && (
        <p className="project-block-note">
          The branches couldn&apos;t be fetched, so some may be missing:{" "}
          {branches.data.fetchProblem}
        </p>
      )}
    </div>
  );
}

/**
 * One branch: its name, then a row per test target on it; for a branch other than the one picked,
 * only the targets launched on it.
 */
function BranchGroup({
  project,
  shown,
  testBranch,
  launchedOnly,
  actions,
}: {
  readonly project: Project;
  readonly shown: ProjectTestInstances;
  readonly testBranch: ProjectTestBranch;
  readonly launchedOnly: boolean;
  readonly actions: TestInstanceActions;
}): ReactNode {
  const rows = shown.targets
    .map((target) => ({ target, instances: instancesOf(testBranch, target) }))
    .filter(({ instances }) => !launchedOnly || instances.length > 0);
  const initiativeOf = (instance: TestInstance): ReactNode => {
    const initiative = shown.initiatives.find(({ id }) => id === instance.initiativeId);
    return (
      initiative && (
        <span className="project-test-instances-initiative">
          in{" "}
          <Link to="/work/initiatives/$initiativeId" params={{ initiativeId: initiative.id }}>
            {initiative.name}
          </Link>
        </span>
      )
    );
  };
  return (
    <section className="test-instances-project" aria-label={testBranch.name}>
      <div className="test-instances-project-head">
        <span className="test-instances-branch">
          <Icon name="git-branch" size={12} />
          <code>{testBranch.name}</code>
        </span>
      </div>
      <ul className="test-instances-targets" aria-label={`Test targets on ${testBranch.name}`}>
        {rows.map(({ target, instances }) => {
          const launchKey = `${testBranch.name}-${target.key}`;
          return (
            <TestTargetLaunchRow
              key={target.key}
              projectName={project.name}
              runEnvironmentOn={shown.runEnvironmentOn}
              branchCommit={testBranch.branchCommit}
              target={target}
              instances={instances}
              launchKey={launchKey}
              onLaunch={() =>
                actions.launch({
                  key: launchKey,
                  targetName: target.name,
                  send: () =>
                    launchOnBranch(project.id, {
                      branch: testBranch.name,
                      targetKey: target.key,
                    }),
                })
              }
              actions={actions}
              aboutInstance={initiativeOf}
            />
          );
        })}
      </ul>
    </section>
  );
}

function instancesOf(
  testBranch: ProjectTestBranch,
  target: LaunchableTestTarget,
): readonly TestInstance[] {
  return testBranch.instances.filter(({ targetKey }) => targetKey === target.key);
}

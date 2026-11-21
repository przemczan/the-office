import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  initiativeBranchOf,
  type Initiative,
  type InitiativeTestInstancesProject,
  type InitiativeTestTarget,
  type Project,
  type TestInstance,
} from "@the-office/contracts";
import { Badge, Button, FoldButton, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { ApiError } from "../../api/api-client.ts";
import {
  launchTestInstance,
  openTestInstance,
  stopTestInstance,
  testInstanceQueries,
} from "../../api/test-instances.ts";
import { BlockLoaderOrProblem } from "../../shell/block-loader.tsx";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { entryPointWords, TEST_TARGET_KIND_LABELS } from "../../shell/test-target-words.ts";
import { useNotices, useToast } from "../../shell/toasts.tsx";
import { useClock } from "../../shell/use-clock.ts";
import {
  branchMovedPast,
  earlierWords,
  instanceAddress,
  instanceLine,
  isActive,
  launchDisabledWhy,
  launchRefusedTitle,
  NEEDS_RUN_ENVIRONMENT,
  NEWER_COMMITS,
  NO_INITIATIVE_BRANCH,
  noTestTargetsWords,
  openRefusedTitle,
  shownTargetsOf,
  stoppedToast,
  TEST_INSTANCE_STATE_TONES,
  TEST_INSTANCE_STATE_WORDS,
  testInstancesFoot,
  testInstancesReadOnly,
  testInstancesShown,
  testInstancesStartOpen,
  testInstancesSummary,
} from "./initiative-test-instances-words.ts";
import { RecordFold } from "./record-fold.tsx";
import { useFold } from "./record-folds.ts";
import { TestInstanceLogWindow } from "./test-instance-log-window.tsx";

/** What a row's actions do, shared by every row and the Log window. */
interface InstanceActions {
  readonly readOnly: boolean;
  readonly launchingKey: string | undefined;
  readonly stoppingId: string | undefined;
  readonly launch: (projectId: string, target: InitiativeTestTarget) => void;
  readonly stop: (instance: TestInstance) => void;
  readonly open: (instance: TestInstance) => void;
  readonly showLog: (instance: TestInstance) => void;
}

/**
 * The Initiative page's Test instances (spec screens/initiative-page.md, "Test instances";
 * docs/design/test-instances.html): once the Initiative is confirmed, a group per Project on its
 * branch with a row per Hosted test target, its newest instance and the earlier ones folded under
 * it. Launch, Stop, Open and Log act from the row; Done or Dropped, it is read-only.
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
  const actions = useInstanceActions(initiative);
  const [logShown, setLogShown] = useState<string>();
  const projectOf = (projectId: string): Project | undefined =>
    projects?.find(({ id }) => id === projectId);
  const shownInstance = logShown === undefined ? undefined : findInstance(groups, logShown);
  const branch =
    initiative.shortName === null ? undefined : initiativeBranchOf(initiative.shortName);
  const withLog: InstanceActions = { ...actions, showLog: (instance) => setLogShown(instance.id) };
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

/**
 * Launch, Stop and Open. Launch and Stop read the block again on their answer, as their event
 * does; a refusal is a toast with the service's reasons, and the row stays as it was.
 */
function useInstanceActions(initiative: Initiative): Omit<InstanceActions, "showLog"> {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const notices = useNotices();
  const readAgain = (): Promise<void> =>
    queryClient.invalidateQueries({
      queryKey: testInstanceQueries.ofInitiative(initiative.id).queryKey,
    });
  const refused = (key: string, title: string, error: Error): void =>
    notices.show({ key, title, description: reasonsOf(error) });
  const launching = useMutation({
    mutationFn: ({ projectId, target }: { projectId: string; target: InitiativeTestTarget }) =>
      launchTestInstance(initiative.id, { projectId, targetKey: target.key }),
    onSuccess: () => readAgain(),
    onError: (error, { projectId, target }) =>
      refused(
        `test-instance-launch-${projectId}-${target.key}`,
        launchRefusedTitle(target.name),
        error,
      ),
  });
  const stopping = useMutation({
    mutationFn: (instance: TestInstance) => stopTestInstance(instance.id),
    onSuccess: async (stopped) => {
      showToast(stoppedToast(stopped.targetName));
      await readAgain();
    },
    onError: (error, instance) =>
      refused(`test-instance-stop-${instance.id}`, `${instance.targetName} can't stop`, error),
  });
  return {
    readOnly: testInstancesReadOnly(initiative),
    launchingKey: launching.isPending
      ? `${launching.variables.projectId}/${launching.variables.target.key}`
      : undefined,
    stoppingId: stopping.isPending ? stopping.variables.id : undefined,
    launch: (projectId, target) => launching.mutate({ projectId, target }),
    stop: (instance) => stopping.mutate(instance),
    open: (instance) => {
      // Opened on the click itself, so no popup blocker stops it; pointed at the link once answered.
      const tab = window.open("", "_blank");
      void openInTab(instance, tab).catch((error: unknown) => {
        tab?.close();
        refused(
          `test-instance-open-${instance.id}`,
          openRefusedTitle(instance.targetName),
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    },
  };
}

/** Asks for the instance's hand-off link and points the tab opened for it there. */
async function openInTab(instance: TestInstance, tab: Window | null): Promise<void> {
  const { url } = await openTestInstance(instance.id);
  if (tab === null) {
    window.open(url, "_blank", "noopener");
    return;
  }
  tab.opener = null;
  tab.location.href = url;
}

function reasonsOf(error: Error): string {
  return error instanceof ApiError ? error.reasons.join(" ") : error.message;
}

/** One Project's group: its mark and name, then a row per Hosted target or why there are none. */
function ProjectGroup({
  group,
  project,
  branch,
  actions,
}: {
  readonly group: InitiativeTestInstancesProject;
  readonly project: Project | undefined;
  readonly branch: string | undefined;
  readonly actions: InstanceActions;
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
          {!group.runEnvironmentOn && !actions.readOnly && (
            <div className="test-instances-note" role="note">
              <Icon name="triangle-alert" size={14} />
              <span>
                {NEEDS_RUN_ENVIRONMENT}{" "}
                <Link
                  to="/projects/$projectId/run-environment"
                  params={{ projectId: group.projectId }}
                >
                  Turn it on in {projectName}&apos;s Run environment section
                </Link>
                .
              </span>
            </div>
          )}
          <ul className="test-instances-targets" aria-label={`Test targets in ${projectName}`}>
            {targets.map((target) => (
              <TargetRow
                key={target.key}
                projectId={group.projectId}
                projectName={projectName}
                runEnvironmentOn={group.runEnvironmentOn}
                branchCommit={group.branchCommit}
                target={target}
                actions={actions}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** A test target's row: its name and kind, its newest instance with what it can do, then the rest. */
function TargetRow({
  projectId,
  projectName,
  runEnvironmentOn,
  branchCommit,
  target,
  actions,
}: {
  readonly projectId: string;
  readonly projectName: string;
  readonly runEnvironmentOn: boolean;
  readonly branchCommit: string | null;
  readonly target: InitiativeTestTarget;
  readonly actions: InstanceActions;
}): ReactNode {
  const now = useClock();
  const [newest, ...earlier] = target.instances;
  const [earlierOpen, setEarlierOpen] = useState(false);
  const launching = actions.launchingKey === `${projectId}/${target.key}`;
  const launchable = !actions.readOnly && (newest === undefined || !isActive(newest.state));
  return (
    <li className="test-instances-target" aria-label={target.name}>
      <div className="test-instances-row">
        <div className="test-instances-main">
          <div className="test-instances-line">
            <span className="test-instances-name">{target.name}</span>
            <Badge size="sm">
              <Icon name="globe" size={11} />
              {TEST_TARGET_KIND_LABELS[target.kind]}
            </Badge>
          </div>
          <div className="test-instances-meta">
            {newest === undefined ? (
              <>
                <span>Not launched yet</span>
                <Separator />
                <code className="test-instances-entry-point">
                  {entryPointWords(target.entryPoint)}
                </code>
              </>
            ) : (
              <>
                <StateBadge instance={newest} />
                {newest.state === "running" && newest.port !== null && (
                  <span className="test-instance-address">
                    {instanceAddress(newest.port, window.location.hostname)}
                  </span>
                )}
                <span>{instanceLine(newest, now)}</span>
                {branchMovedPast(newest, branchCommit) && (
                  <span
                    className="test-instances-newer"
                    title="Launch again to try the branch's newest commit"
                  >
                    <Icon name="triangle-alert" size={12} />
                    {NEWER_COMMITS}
                  </span>
                )}
              </>
            )}
          </div>
          {newest?.state === "failed" && newest.failedReason !== null && (
            <p className="test-instances-reason">{newest.failedReason}</p>
          )}
        </div>
        <div className="test-instances-actions">
          {newest?.state === "running" && (
            <Button
              size="sm"
              variant="primary"
              iconLeft={<Icon name="external-link" size={14} />}
              title={`Open ${target.name} in a new tab`}
              onClick={() => actions.open(newest)}
            >
              Open
            </Button>
          )}
          {newest !== undefined && isActive(newest.state) && (
            <Button
              size="sm"
              variant="secondary"
              iconLeft={<Icon name="square" size={14} />}
              loading={actions.stoppingId === newest.id}
              disabled={actions.stoppingId === newest.id}
              onClick={() => actions.stop(newest)}
            >
              Stop
            </Button>
          )}
          {launchable && (
            <Button
              size="sm"
              variant="secondary"
              iconLeft={<Icon name={newest === undefined ? "play" : "rotate-cw"} size={14} />}
              loading={launching}
              disabled={!runEnvironmentOn || launching}
              title={runEnvironmentOn ? undefined : launchDisabledWhy(projectName)}
              onClick={() => actions.launch(projectId, target)}
            >
              {newest === undefined ? "Launch" : "Launch again"}
            </Button>
          )}
          {newest !== undefined && (
            <Button
              size="sm"
              variant="ghost"
              iconLeft={<Icon name="scroll-text" size={14} />}
              onClick={() => actions.showLog(newest)}
            >
              Log
            </Button>
          )}
        </div>
      </div>
      {earlier.length > 0 && (
        <div className="test-instances-earlier">
          <FoldButton
            className="test-instances-earlier-toggle"
            unfolded={earlierOpen}
            onClick={() => setEarlierOpen(!earlierOpen)}
          >
            {earlierWords(earlier.length)}
          </FoldButton>
          {earlierOpen && (
            <ul className="test-instances-earlier-list" aria-label={`Earlier ${target.name}`}>
              {earlier.map((instance) => (
                <li key={instance.id}>
                  <StateBadge instance={instance} />
                  <span>{instanceLine(instance, now)}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    iconLeft={<Icon name="scroll-text" size={14} />}
                    onClick={() => actions.showLog(instance)}
                  >
                    Log
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function StateBadge({ instance }: { readonly instance: TestInstance }): ReactNode {
  return (
    <Badge size="sm" tone={TEST_INSTANCE_STATE_TONES[instance.state]}>
      {instance.state === "building" && (
        <span className="test-instances-spinner" aria-hidden="true">
          <Icon name="loader-circle" size={11} />
        </span>
      )}
      {TEST_INSTANCE_STATE_WORDS[instance.state]}
    </Badge>
  );
}

function Separator(): ReactNode {
  return (
    <span className="test-instances-separator" aria-hidden="true">
      ·
    </span>
  );
}

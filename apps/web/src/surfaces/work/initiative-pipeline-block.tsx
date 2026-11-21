import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  initiativeBranchOf,
  type Initiative,
  type Pipeline,
  type Project,
  type ProjectPipeline,
  type Role,
  type Task,
  type TaskStages,
} from "@the-office/contracts";
import { Alert, Button, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { roleQueries } from "../../api/people.ts";
import { pipelineQueries, projectPipelineQueries } from "../../api/pipelines.ts";
import {
  taskPipelineChoices,
  type PipelineChoiceGroup,
} from "../../shell/pipelines/pipeline-choices.ts";
import { asPipeline } from "../../shell/pipelines/use-pipelines.ts";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { NOT_STARTED } from "../../shell/work/work-words.ts";
import { TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import {
  branchNoteWords,
  hasGate,
  hasStarted,
  NO_BRANCH_WHILE_SHAPING,
  NONE_CONFIRMED,
  pipelineShapeWords,
  pipelinesFoldedLine,
  pipelinesFootWords,
  pipelinesStartOpen,
  publishedWords,
  type PipelineShown,
  type ProjectPublishing,
} from "./initiative-pipeline-words.ts";
import { InitiativePipelineTrack } from "./initiative-pipeline-track.tsx";
import { InitiativePipelinesEditor } from "./initiative-pipelines-editor.tsx";
import {
  initiativePipelineIn,
  publishingTasksOf,
  publishingWaitWords,
} from "./initiative-words.ts";
import { RecordFold } from "./record-fold.tsx";
import { useFold } from "./record-folds.ts";
import { StageHistoryWindow } from "./stage-history-window.tsx";
import { stagesOnRail } from "./stage-rail-words.ts";
import { stageNamesOf } from "./stage-words.ts";
import { useStageHistory } from "./use-stage-history.ts";

/** "Admin panel and Website", "A, B, and C". */
const PROJECT_NAMES = new Intl.ListFormat("en", { type: "conjunction" });

/** One Project the Initiative spans, as its block shows it. */
interface ProjectBlockData {
  readonly projectId: string;
  readonly project: Project | undefined;
  readonly projectName: string;
  /** The Initiative's Pipeline there; null for None. */
  readonly pipelineId: string | null;
  readonly pipeline: PipelineShown | undefined;
  /** Its Publishing Task once added, with its Stages once read. */
  readonly publishingTask: Task | undefined;
  readonly taskStages: TaskStages | undefined;
}

/**
 * The Pipelines card (docs/design/initiative-pipelines-block.html; spec 2.1 "An Initiative's
 * Pipeline"): each Project the Initiative spans works on its Initiative's branch, published through
 * a Pipeline of its own, or publishes Task by Task. It reads as facts, the branch first, then each
 * Project's Pipeline with its Publishing Task's progress through its Stages, each Stage opening
 * that Task's Stage history. While shaping, Edit in its head opens the editor, which saves it all
 * at once; while active with an Initiative's branch, Edit opens it too, where only the Pipelines of
 * the Projects on a branch change, until each one's Publishing Task starts.
 */
export function InitiativePipelineBlock({
  initiative,
  tasks,
  projects,
}: {
  readonly initiative: Initiative;
  /** Every Task, where its Publishing Tasks and their blockers are read. */
  readonly tasks: readonly Task[];
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const fold = useFold(
    { kind: "initiative", id: initiative.id },
    "pipeline",
    pipelinesStartOpen(initiative),
  );
  const officeWide = useQuery(pipelineQueries.list()).data;
  const projectPipelines = useQuery(projectPipelineQueries.every()).data;
  const roles = useQuery(roleQueries.list()).data;
  const publishing = publishingTasksOf(initiative, tasks);
  const publishingStages = useQueries({
    queries: publishing.map(({ id }) => pipelineQueries.taskStages(id)),
  });
  const pipelineOf = (pipelineId: string | null): PipelineShown | undefined =>
    pipelineId === null ? undefined : findPipeline(pipelineId, officeWide, projectPipelines);
  const blocks: ProjectBlockData[] = initiative.projectIds.map((projectId) => {
    const project = projects?.find(({ id }) => id === projectId);
    const pipelineId = initiativePipelineIn(initiative, projectId);
    // A Project's latest Publishing Task, should one have been dropped and another added.
    const publishingTask = publishing.findLast((task) => task.projectId === projectId);
    const stagesRead = publishingTask && publishingStages[publishing.indexOf(publishingTask)]?.data;
    return {
      projectId,
      project,
      projectName: project?.name ?? projectId,
      pipelineId,
      pipeline: pipelineOf(pipelineId),
      publishingTask,
      taskStages: stagesRead,
    };
  });
  const shaping = initiative.state === "shaping";
  const editable = shaping || (initiative.state === "active" && initiative.branches.length > 0);
  const read: ProjectPublishing[] = blocks.map((block) => ({
    projectName: block.projectName,
    pipelineName: block.pipelineId === null ? null : (block.pipeline?.name ?? block.pipelineId),
    publishingTask: block.publishingTask && {
      state: block.publishingTask.state,
      stages: stagesOnRail(block.taskStages?.stages ?? null, block.pipeline?.stages),
    },
  }));
  const [editing, setEditing] = useState(false);
  const withPipeline = blocks.filter(({ pipelineId }) => pipelineId !== null);
  const foot = pipelinesFootWords(initiative.state, read);
  return (
    <RecordFold
      fold={fold}
      icon="route"
      title="Pipelines"
      summary={pipelinesFoldedLine(initiative.state, read, initiative.branches.length)}
      side={
        editable && !editing ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setEditing(true);
              if (!fold.isOpen) fold.toggle();
            }}
          >
            Edit
          </Button>
        ) : undefined
      }
    >
      {editable && editing ? (
        <InitiativePipelinesEditor
          initiative={initiative}
          projects={blocks.map(({ projectId, project, projectName, pipelineId }) => ({
            projectId,
            project,
            projectName,
            pipelineId,
            groups: choiceGroups(project, officeWide, projectPipelines),
            onBranch: initiative.branches.some((branch) => branch.projectId === projectId),
            publishingStarted: publishing.some(
              (task) => task.projectId === projectId && hasStarted(task.state),
            ),
          }))}
          pipelineOf={pipelineOf}
          onClose={() => setEditing(false)}
        />
      ) : (
        <div className="initiative-pipelines">
          {withPipeline.length === 0 ? (
            <NoBranch shaping={shaping} />
          ) : (
            <>
              <PipelinesFacts
                initiative={initiative}
                withPipeline={withPipeline}
                taskByTask={blocks.filter(({ pipelineId }) => pipelineId === null)}
                manyProjects={blocks.length > 1}
              />
              <ol className="initiative-pipelines-projects" aria-label="Projects">
                {withPipeline.map((block) => (
                  <ProjectBlock
                    key={block.projectId}
                    initiative={initiative}
                    block={block}
                    tasks={tasks}
                    roles={roles}
                    pipelineOf={pipelineOf}
                  />
                ))}
              </ol>
            </>
          )}
          {foot !== undefined && <p className="initiative-pipelines-foot">{foot}</p>}
        </div>
      )}
    </RecordFold>
  );
}

/** The card while no Project works on an Initiative's branch. */
function NoBranch({ shaping }: { readonly shaping: boolean }): ReactNode {
  return shaping ? (
    <p className="initiative-pipelines-none-line">
      <b>No Initiative's branch.</b> {NO_BRANCH_WHILE_SHAPING}
    </p>
  ) : (
    <div className="initiative-pipelines-none">
      <p>{NONE_CONFIRMED}.</p>
      <p>
        Each Task publishes on its own, as it is done. Whether its Projects have a Pipeline was
        fixed at Confirm.
      </p>
    </div>
  );
}

/**
 * The facts above the Projects' Pipelines: the Initiative's branch and where it is, then the
 * Projects that publish Task by Task.
 */
function PipelinesFacts({
  initiative,
  withPipeline,
  taskByTask,
  manyProjects,
}: {
  readonly initiative: Initiative;
  readonly withPipeline: readonly ProjectBlockData[];
  readonly taskByTask: readonly ProjectBlockData[];
  readonly manyProjects: boolean;
}): ReactNode {
  const note = branchNoteWords(initiative.state);
  return (
    <dl className="initiative-pipelines-facts">
      <dt>
        <Icon name="git-branch" size={13} />
        Initiative's branch
      </dt>
      <dd>
        {initiative.shortName !== null && (
          <code className="initiative-pipelines-branch">
            <Icon name="git-branch" size={12} />
            {initiativeBranchOf(initiative.shortName)}
          </code>
        )}
        {note !== undefined && <span className="initiative-pipelines-quiet">{note}</span>}
        {manyProjects && (
          <span className="initiative-pipelines-quiet">
            in {PROJECT_NAMES.format(withPipeline.map(({ projectName }) => projectName))}
          </span>
        )}
      </dd>
      {taskByTask.length > 0 && (
        <>
          <dt>Task by Task</dt>
          <dd>
            {taskByTask.map(({ projectId, project, projectName }) => (
              <span key={projectId} className="initiative-pipelines-project-name">
                {project && <ProjectMark project={project} />}
                {projectName}
              </span>
            ))}
            <span className="initiative-pipelines-quiet">
              publishes each Task on its own, as it is done
            </span>
          </dd>
        </>
      )}
    </dl>
  );
}

function findPipeline(
  pipelineId: string,
  officeWide: readonly Pipeline[] | undefined,
  projectPipelines: readonly ProjectPipeline[] | undefined,
): PipelineShown | undefined {
  const projectPipeline = projectPipelines?.find(({ id }) => id === pipelineId);
  return (
    officeWide?.find(({ id }) => id === pipelineId) ??
    (projectPipeline && asPipeline(projectPipeline))
  );
}

/**
 * A Project's choices, grouped as a Task's Pipeline picker groups them: its own Project Pipelines,
 * then the office-wide ones; undefined until they are read.
 */
function choiceGroups(
  project: Project | undefined,
  officeWide: readonly Pipeline[] | undefined,
  projectPipelines: readonly ProjectPipeline[] | undefined,
): readonly PipelineChoiceGroup[] | undefined {
  if (project === undefined || officeWide === undefined || projectPipelines === undefined) {
    return undefined;
  }
  return taskPipelineChoices(project, officeWide, projectPipelines);
}

/** One Project's block: its head and Pipeline, its Publishing Task, then its track. */
function ProjectBlock({
  initiative,
  block,
  tasks,
  roles,
  pipelineOf,
}: {
  readonly initiative: Initiative;
  readonly block: ProjectBlockData;
  readonly tasks: readonly Task[];
  readonly roles: readonly Role[] | undefined;
  readonly pipelineOf: (pipelineId: string | null) => PipelineShown | undefined;
}): ReactNode {
  const { projectId, project, projectName, publishingTask, pipelineId, pipeline } = block;
  const shaping = initiative.state === "shaping";
  const shape = pipeline && pipelineShapeWords(pipeline.stages);
  const label = `${pipeline?.name ?? pipelineId} in ${projectName}`;
  return (
    <li className="initiative-pipelines-project" aria-label={projectName}>
      <div className="initiative-pipelines-head">
        <span className="initiative-pipelines-project-name">
          {project && <ProjectMark project={project} />}
          {projectName}
        </span>
        <span className="initiative-pipelines-shape">
          <b>{pipeline?.name ?? pipelineId}</b>
          {shape && ` · ${shape}`}
        </span>
      </div>
      <PublishingLabel
        initiative={initiative}
        block={block}
        edited={block.taskStages?.editedForTask === true}
      />
      {publishingTask && <PublishingWait task={publishingTask} tasks={tasks} />}
      {shaping && pipeline && !hasGate(pipeline.stages) && (
        <Alert tone="warning" title="Publishes without your review">
          No Stage of {pipeline.name} is a Gate, so the Initiative's branch in {projectName} is
          published into {project?.baseBranch ?? "its base branch"} without you looking at it first.
        </Alert>
      )}
      {publishingTask ? (
        block.taskStages && (
          <PublishingTrack
            task={publishingTask}
            taskStages={block.taskStages}
            pipeline={pipelineOf(publishingTask.pipelineId ?? pipelineId)}
            label={label}
            project={project}
            roles={roles}
          />
        )
      ) : (
        <InitiativePipelineTrack
          label={label}
          stages={stagesOnRail(null, pipeline?.stages)}
          placeholder
          roles={roles}
          commands={project?.commands}
          selectedKey={undefined}
          stageElementId={(stageKey) => `${projectId}-${stageKey}`}
          onSelect={() => undefined}
        />
      )}
    </li>
  );
}

/**
 * The line under a Project's head: its Publishing Task's title and state once added, and "No
 * Publishing Task yet" while active before; nothing while shaping.
 */
function PublishingLabel({
  initiative,
  block: { project, publishingTask },
  edited,
}: {
  readonly initiative: Initiative;
  readonly block: ProjectBlockData;
  readonly edited: boolean;
}): ReactNode {
  if (publishingTask === undefined && initiative.state !== "active") return null;
  return (
    <div className="initiative-pipelines-label">
      {publishingTask ? (
        <>
          <Link to="/tasks/$taskId" params={{ taskId: publishingTask.id }}>
            {publishingTask.title}
          </Link>
          <TaskStateBadge state={publishingTask.state} />
          {publishingTask.state === "done" && project && (
            <span className="initiative-pipelines-published">{publishedWords(project)}</span>
          )}
          {edited && (
            <span className="initiative-pipelines-edited">Stages edited for this Task</span>
          )}
        </>
      ) : (
        <span className="initiative-pipelines-pending">No Publishing Task yet</span>
      )}
    </div>
  );
}

/** What a started Publishing Task waits for before its next Stage, in the warning colour. */
function PublishingWait({
  task,
  tasks,
}: {
  readonly task: Task;
  readonly tasks: readonly Task[];
}): ReactNode {
  const wait = publishingWaitWords(task, tasks);
  return wait === undefined ? null : <p className="initiative-pipelines-wait">{wait}</p>;
}

/** A Publishing Task's track, each Stage opening its Stage history in the large window, on this page. */
function PublishingTrack({
  task,
  taskStages,
  pipeline,
  label,
  project,
  roles,
}: {
  readonly task: Task;
  readonly taskStages: TaskStages;
  readonly pipeline: PipelineShown | undefined;
  readonly label: string;
  readonly project: Project | undefined;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const history = useStageHistory(task.id, undefined, undefined);
  const stages = stagesOnRail(taskStages.stages, pipeline?.stages);
  const names = stageNamesOf(stages.map(({ stage }) => stage));
  const selected = stages.find(({ stage }) => stage.key === history.shown?.stageKey);
  const stageElementId = (stageKey: string): string => `publishing-${task.id}-${stageKey}`;
  return (
    <>
      <InitiativePipelineTrack
        label={label}
        stages={stages}
        placeholder={false}
        roles={roles}
        commands={project?.commands}
        selectedKey={selected?.stage.key}
        stageElementId={stageElementId}
        onSelect={history.show}
      />
      {selected && (
        <StageHistoryWindow
          taskId={task.id}
          stages={stages}
          taskStage={selected}
          askedRunId={undefined}
          noRunsWords={
            NOT_STARTED.includes(task.state) ? "Runs once the Task starts." : "Hasn't run yet."
          }
          roles={roles}
          names={names}
          onSelect={history.show}
          onClose={() => {
            history.close();
            document.getElementById(stageElementId(selected.stage.key))?.focus();
          }}
        />
      )}
    </>
  );
}

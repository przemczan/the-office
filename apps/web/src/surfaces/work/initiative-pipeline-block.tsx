import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  initiativeBranchOf,
  SHORT_NAME_MAX_LENGTH,
  type Initiative,
  type Pipeline,
  type Project,
  type ProjectPipeline,
  type Role,
  type Stage,
  type Task,
  type TaskStages,
} from "@the-office/contracts";
import { Alert, Button, Icon, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { roleQueries } from "../../api/people.ts";
import { pipelineQueries, projectPipelineQueries } from "../../api/pipelines.ts";
import { chooseInitiativePipeline, writeShortName } from "../../api/work.ts";
import {
  taskPipelineChoices,
  type PipelineChoiceGroup,
} from "../../shell/pipelines/pipeline-choices.ts";
import { PipelinePicker } from "../../shell/pipelines/pipeline-picker.tsx";
import { asPipeline } from "../../shell/pipelines/use-pipelines.ts";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { NOT_STARTED } from "../../shell/work/work-words.ts";
import { TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import {
  branchNoteWords,
  hasGate,
  NONE_CONFIRMED,
  noneLineWords,
  pipelineShapeWords,
  pipelinesFoldedLine,
  pipelinesFootWords,
  pipelinesStartOpen,
  publishedWords,
  type ProjectPublishing,
} from "./initiative-pipeline-words.ts";
import { InitiativePipelineTrack } from "./initiative-pipeline-track.tsx";
import { initiativePipelineIn, publishingTasksOf, publishingWaitWords } from "./initiative-words.ts";
import { RecordFold } from "./record-fold.tsx";
import { useFold } from "./record-folds.ts";
import { StageHistoryWindow } from "./stage-history-window.tsx";
import { stagesOnRail } from "./stage-rail-words.ts";
import { stageNamesOf } from "./stage-words.ts";
import { useInitiativeChange } from "./use-initiative-change.ts";
import { useStageHistory } from "./use-stage-history.ts";

/** The picker's value for None: a Pipeline's id is never empty. */
const NONE = "";

/** None, first in the picker, in a group of its own. */
const NONE_GROUP: PipelineChoiceGroup = {
  label: "No Pipeline",
  choices: [
    {
      id: NONE,
      name: "None",
      stages: [],
      line: "Each Task publishes on its own, as it is done",
      isDefault: false,
      brokenWhy: undefined,
      brokenReasons: [],
    },
  ],
};

/** A Pipeline as the card reads it: by its id, among the office-wide ones and the Project Pipelines. */
interface PipelineShown {
  readonly name: string;
  readonly stages: readonly Stage[];
}

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
 * The Pipelines card (docs/design/README.md, "The Initiative page: what it proposes", point 3; spec
 * 2.1 "An Initiative's Pipeline"): each Project the Initiative spans publishes through a Pipeline
 * of its own, or None. While shaping each Project's block chooses it and the Short name is edited
 * above them; once confirmed each block shows its Pipeline, its Initiative's branch and its
 * Publishing Task's progress through its Stages, each Stage opening that Task's Stage history.
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
    const stagesRead =
      publishingTask && publishingStages[publishing.indexOf(publishingTask)]?.data;
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
  const read: ProjectPublishing[] = blocks.map((block) => ({
    projectName: block.projectName,
    pipelineName: block.pipelineId === null ? null : (block.pipeline?.name ?? block.pipelineId),
    publishingTask: block.publishingTask && {
      state: block.publishingTask.state,
      stages: stagesOnRail(block.taskStages?.stages ?? null, block.pipeline?.stages),
    },
  }));
  const anyPipeline = blocks.some(({ pipelineId }) => pipelineId !== null);
  const foot = pipelinesFootWords(initiative.state, read);
  return (
    <RecordFold
      fold={fold}
      icon="route"
      title="Pipelines"
      summary={pipelinesFoldedLine(initiative.state, read, initiative.branches.length)}
    >
      <div className="initiative-pipelines">
        {shaping && (
          <div className="initiative-pipelines-choice">
            <p className="initiative-pipelines-intro">
              Each Project publishes through a Pipeline of its own, or None. Whether a Project has
              one is fixed at Confirm.
            </p>
            {anyPipeline && <ShortName initiative={initiative} />}
          </div>
        )}
        {!shaping && !anyPipeline ? (
          <div className="initiative-pipelines-none">
            <p>{NONE_CONFIRMED}.</p>
            <p>
              Each Task publishes on its own, as it is done. Whether its Projects have a Pipeline
              was fixed at Confirm.
            </p>
          </div>
        ) : (
          <ol className="initiative-pipelines-projects" aria-label="Projects">
            {blocks.map((block) => (
              <ProjectBlock
                key={block.projectId}
                initiative={initiative}
                block={block}
                tasks={tasks}
                roles={roles}
                groups={choiceGroups(block.project, officeWide, projectPipelines)}
                pipelineOf={pipelineOf}
              />
            ))}
          </ol>
        )}
        {foot !== undefined && <p className="initiative-pipelines-foot">{foot}</p>}
      </div>
    </RecordFold>
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
 * then the office-wide ones, with None first; undefined until they are read.
 */
function choiceGroups(
  project: Project | undefined,
  officeWide: readonly Pipeline[] | undefined,
  projectPipelines: readonly ProjectPipeline[] | undefined,
): readonly PipelineChoiceGroup[] | undefined {
  if (project === undefined || officeWide === undefined || projectPipelines === undefined) {
    return undefined;
  }
  return [NONE_GROUP, ...taskPipelineChoices(project, officeWide, projectPipelines)];
}

/** One Project's block: its head and Pipeline, its Publishing Task and branch, then its track. */
function ProjectBlock({
  initiative,
  block,
  tasks,
  roles,
  groups,
  pipelineOf,
}: {
  readonly initiative: Initiative;
  readonly block: ProjectBlockData;
  readonly tasks: readonly Task[];
  readonly roles: readonly Role[] | undefined;
  readonly groups: readonly PipelineChoiceGroup[] | undefined;
  readonly pipelineOf: (pipelineId: string | null) => PipelineShown | undefined;
}): ReactNode {
  const { projectId, project, projectName, publishingTask } = block;
  const shaping = initiative.state === "shaping";
  const choosing = useInitiativeChange(initiative, (pipelineId: string | null) =>
    chooseInitiativePipeline(initiative.id, { projectId, pipelineId }),
  );
  // The choice shows at once, while the service saves it.
  const pipelineId = choosing.isPending ? choosing.variables : block.pipelineId;
  const pipeline = choosing.isPending ? pipelineOf(pipelineId) : block.pipeline;
  const shape = pipeline && pipelineShapeWords(pipeline.stages);
  return (
    <li className="initiative-pipelines-project" aria-label={projectName}>
      {choosing.error && <RefusalAlert title="The Pipeline wasn't chosen" error={choosing.error} />}
      <div className="initiative-pipelines-head">
        <span className="initiative-pipelines-project-name">
          {project && <ProjectMark project={project} />}
          {projectName}
        </span>
        {shaping ? (
          <>
            <PipelinePicker
              label={`${projectName}'s Pipeline`}
              labelHidden
              size="sm"
              value={pipelineId ?? NONE}
              groups={groups ?? [NONE_GROUP]}
              disabled={groups === undefined}
              onChange={(value) => choosing.mutate(value === NONE ? null : value)}
            />
            {shape && <span className="initiative-pipelines-shape">{shape}</span>}
          </>
        ) : (
          <span className="initiative-pipelines-shape">
            {pipelineId === null ? (
              <>
                <b>None</b> · publishes Task by Task
              </>
            ) : (
              <>
                <b>{pipeline?.name ?? pipelineId}</b>
                {shape && ` · ${shape}`}
              </>
            )}
          </span>
        )}
      </div>
      {pipelineId === null ? (
        <p className="initiative-pipelines-none-line">{noneLineWords(shaping)}</p>
      ) : (
        <>
          <PublishingLabel
            initiative={initiative}
            block={block}
            edited={block.taskStages?.editedForTask === true}
          />
          {publishingTask && <PublishingWait task={publishingTask} tasks={tasks} />}
          {shaping && pipeline && !hasGate(pipeline.stages) && (
            <Alert tone="warning" title="Publishes without your review">
              No Stage of {pipeline.name} is a Gate, so the Initiative's branch in {projectName} is
              published into {project?.baseBranch ?? "its base branch"} without you looking at it
              first.
            </Alert>
          )}
          {publishingTask ? (
            block.taskStages && (
              <PublishingTrack
                task={publishingTask}
                taskStages={block.taskStages}
                pipeline={pipelineOf(publishingTask.pipelineId ?? pipelineId)}
                label={`${pipeline?.name ?? pipelineId} in ${projectName}`}
                project={project}
                roles={roles}
              />
            )
          ) : (
            <InitiativePipelineTrack
              label={`${pipeline?.name ?? pipelineId} in ${projectName}`}
              stages={stagesOnRail(null, pipeline?.stages)}
              placeholder
              roles={roles}
              commands={project?.commands}
              selectedKey={undefined}
              stageElementId={(stageKey) => `${projectId}-${stageKey}`}
              onSelect={() => undefined}
            />
          )}
        </>
      )}
    </li>
  );
}

/**
 * The line under a Project's head: its Publishing Task's title and state once added, "No Publishing
 * Task yet" while active before, and its Initiative's branch.
 */
function PublishingLabel({
  initiative,
  block: { projectId, project, publishingTask },
  edited,
}: {
  readonly initiative: Initiative;
  readonly block: ProjectBlockData;
  readonly edited: boolean;
}): ReactNode {
  const branch =
    initiative.state === "shaping"
      ? initiative.shortName === null
        ? undefined
        : initiativeBranchOf(initiative.shortName)
      : initiative.branches.find((made) => made.projectId === projectId)?.branch;
  const note = branchNoteWords(initiative.state);
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
          {edited && <span className="initiative-pipelines-edited">Stages edited for this Task</span>}
        </>
      ) : (
        initiative.state === "active" && (
          <span className="initiative-pipelines-pending">No Publishing Task yet</span>
        )
      )}
      {branch !== undefined && (
        <span className="initiative-pipelines-branch">
          <Icon name="git-branch" size={12} />
          <code>{branch}</code>
          {note !== undefined && <span className="initiative-pipelines-branch-note">· {note}</span>}
        </span>
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

/** The Short name, shown and edited while shaping; the service derives it when a Pipeline is chosen. */
function ShortName({ initiative }: { readonly initiative: Initiative }): ReactNode {
  const [editing, setEditing] = useState(false);
  const writing = useInitiativeChange(initiative, (shortName: string) =>
    writeShortName(initiative.id, shortName),
  );
  const shortName = initiative.shortName ?? "";
  return (
    <div className="initiative-short-name">
      {writing.error && <RefusalAlert title="The Short name wasn't saved" error={writing.error} />}
      {editing ? (
        <ShortNameEditor
          initial={shortName}
          saving={writing.isPending}
          onSave={(edited) => writing.mutate(edited, { onSuccess: () => setEditing(false) })}
          onCancel={() => {
            writing.reset();
            setEditing(false);
          }}
        />
      ) : (
        <div className="initiative-short-name-row">
          <span className="initiative-short-name-label">Short name</span>
          <code>{shortName === "" ? "Not made yet" : shortName}</code>
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      )}
      {!editing && shortName !== "" && (
        <p className="task-quiet">
          At Confirm, each Project with a Pipeline gets the branch{" "}
          <code>{initiativeBranchOf(shortName)}</code>.
        </p>
      )}
    </div>
  );
}

function ShortNameEditor({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  readonly initial: string;
  readonly saving: boolean;
  readonly onSave: (shortName: string) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const [text, setText] = useState(initial);
  return (
    <form
      className="task-part-editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(text.trim());
      }}
    >
      <Input
        label="Short name"
        hint={`Lower-case a–z, 0–9 and -, at most ${SHORT_NAME_MAX_LENGTH} characters. The branch is ${initiativeBranchOf(text.trim())}.`}
        size="sm"
        value={text}
        maxLength={SHORT_NAME_MAX_LENGTH}
        onChange={(event) => setText(event.target.value)}
        inputStyle={{ fontFamily: "var(--font-mono)" }}
        autoFocus
      />
      <div className="task-part-actions">
        <Button size="sm" type="submit" loading={saving} iconLeft={<Icon name="check" size={14} />}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

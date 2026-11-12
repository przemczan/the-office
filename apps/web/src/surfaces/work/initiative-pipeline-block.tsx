import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  initiativeBranchOf,
  SHORT_NAME_MAX_LENGTH,
  type Initiative,
  type Pipeline,
  type Project,
  type Task,
} from "@the-office/contracts";
import { Alert, Button, Icon, Input, Select } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { pipelineQueries } from "../../api/pipelines.ts";
import { chooseInitiativePipeline, writeShortName } from "../../api/work.ts";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import { stagesLine } from "../../shell/pipelines/pipeline-words.ts";
import { publishingTasksOf, publishingWaitWords } from "./initiative-words.ts";
import { RecordFold } from "./record-fold.tsx";
import { useFold } from "./record-folds.ts";
import { useInitiativeChange } from "./use-initiative-change.ts";

/** The Select's value for None: a library Pipeline's id is never empty. */
const NONE = "";

/** What None does, once whether it has a Pipeline is fixed. */
const NONE_CONFIRMED = "None: publishes Task by Task";

/** A Pipeline with no Gate publishes the Initiative's branch with nobody looking at it. */
function hasGate(pipeline: Pipeline): boolean {
  return pipeline.stages.some((stage) => stage.kind === "gate");
}

/** The Pipeline's name from the library, or its id while the library loads or lacks it. */
function pipelineName(pipelineId: string, pipelines: readonly Pipeline[] | undefined): string {
  return pipelines?.find(({ id }) => id === pipelineId)?.name ?? pipelineId;
}

/**
 * The Initiative's Pipeline (spec §2.1 "An Initiative's Pipeline"): while it is being shaped the
 * user chooses None or a library Pipeline and edits the Short name its branches are named by;
 * once confirmed it shows the Pipeline, the Initiative's branch in each Project (spec §5.5) and,
 * once added, the Publishing Tasks (spec 4).
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
  const fold = useFold({ kind: "initiative", id: initiative.id }, "pipeline", true);
  const pipelines = useQuery(pipelineQueries.list()).data;
  const shaping = initiative.state === "shaping";
  const summary =
    initiative.pipelineId === null
      ? shaping
        ? "None"
        : NONE_CONFIRMED
      : pipelineName(initiative.pipelineId, pipelines);
  return (
    <RecordFold fold={fold} icon="route" title="Pipeline" summary={summary}>
      {shaping ? (
        <ShapingPipeline initiative={initiative} pipelines={pipelines} />
      ) : (
        <ConfirmedPipeline
          initiative={initiative}
          tasks={tasks}
          pipelines={pipelines}
          projects={projects}
        />
      )}
    </RecordFold>
  );
}

function ShapingPipeline({
  initiative,
  pipelines,
}: {
  readonly initiative: Initiative;
  readonly pipelines: readonly Pipeline[] | undefined;
}): ReactNode {
  const choosing = useInitiativeChange(initiative, (pipelineId: string | null) =>
    chooseInitiativePipeline(initiative.id, pipelineId),
  );
  // The choice shows at once, while the service saves it.
  const pipelineId = choosing.isPending ? choosing.variables : initiative.pipelineId;
  const chosen = pipelineId === null ? undefined : pipelines?.find(({ id }) => id === pipelineId);
  return (
    <div className="initiative-pipeline">
      {choosing.error && <RefusalAlert title="The Pipeline wasn't chosen" error={choosing.error} />}
      <Select
        label="Initiative's Pipeline"
        hint="Whether it has a Pipeline is fixed at Confirm."
        size="sm"
        value={pipelineId ?? NONE}
        options={[
          { value: NONE, label: "None" },
          ...(pipelines ?? []).map(({ id, name }) => ({ value: id, label: name })),
        ]}
        disabled={pipelines === undefined}
        onChange={(value) => choosing.mutate(value === NONE ? null : value)}
      />
      {pipelineId === null ? (
        <p className="task-quiet">None: each Task publishes on its own, as it is done.</p>
      ) : (
        <>
          {chosen && <p className="task-quiet">{stagesLine(chosen)}</p>}
          {chosen && !hasGate(chosen) && (
            <Alert tone="warning" title="Publishes without your review">
              No Stage of {chosen.name} is a Gate, so the Initiative's branch is published into each
              base branch without you looking at it first.
            </Alert>
          )}
          <ShortName initiative={initiative} />
        </>
      )}
    </div>
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
          At Confirm, each Project it spans gets the branch{" "}
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

function ConfirmedPipeline({
  initiative,
  tasks,
  pipelines,
  projects,
}: {
  readonly initiative: Initiative;
  readonly tasks: readonly Task[];
  readonly pipelines: readonly Pipeline[] | undefined;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  if (initiative.pipelineId === null) return <p className="task-plan">{NONE_CONFIRMED}</p>;
  const ended = initiative.state === "done" || initiative.state === "dropped";
  return (
    <div className="initiative-pipeline">
      <p className="task-plan">{pipelineName(initiative.pipelineId, pipelines)}</p>
      {initiative.branches.length === 0 ? (
        <p className="task-quiet">
          {ended ? "It made no Initiative's branch." : "No Initiative's branch yet."}
        </p>
      ) : (
        <ul className="initiative-branches" aria-label="Initiative's branches">
          {initiative.branches.map(({ projectId, branch }) => (
            <li key={projectId}>
              <ProjectChip projectId={projectId} projects={projects} /> <code>{branch}</code>
              {ended && <span className="task-quiet"> · kept for you to delete</span>}
            </li>
          ))}
        </ul>
      )}
      <PublishingTasks initiative={initiative} tasks={tasks} projects={projects} />
      {initiative.state === "active" && (
        <p className="task-quiet">Another Pipeline comes by the CTO's Proposal.</p>
      )}
    </div>
  );
}

/**
 * The Publishing Tasks, one per Project, each publishing the Initiative's whole change there
 * (spec 2.1, "Publishing Tasks"): its title linking it, its Project and state, and what a started
 * one waits for before its next Stage.
 */
function PublishingTasks({
  initiative,
  tasks,
  projects,
}: {
  readonly initiative: Initiative;
  readonly tasks: readonly Task[];
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const publishing = publishingTasksOf(initiative, tasks);
  if (publishing.length === 0) {
    return initiative.state === "active" ? (
      <p className="task-quiet">
        Once every other Task is Done or Dropped, The Office adds a Publishing Task in each Project
        whose branch holds work, to publish the whole change.
      </p>
    ) : null;
  }
  return (
    <ul className="initiative-publishing-tasks" aria-label="Publishing Tasks">
      {publishing.map((task) => {
        const wait = publishingWaitWords(task, tasks);
        return (
          <li key={task.id}>
            <ProjectChip projectId={task.projectId} projects={projects} />{" "}
            <Link to="/tasks/$taskId" params={{ taskId: task.id }}>
              {task.title}
            </Link>{" "}
            <TaskStateBadge state={task.state} />
            {wait && <p className="task-quiet">{wait}</p>}
          </li>
        );
      })}
    </ul>
  );
}

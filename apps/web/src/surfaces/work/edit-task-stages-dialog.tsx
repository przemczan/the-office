import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Pipeline,
  Project,
  Role,
  RoleCardOptions,
  Stage,
  Task,
  TaskStages,
} from "@the-office/contracts";
import { Alert, Button, Dialog, Select } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { roleCardQueries, roleQueries } from "../../api/people.ts";
import { editTaskStages, pipelineQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { setPipeline } from "../../api/work.ts";
import { StageEditor } from "../../shell/pipelines/stage-editor.tsx";
import type { StageCommand } from "../../shell/pipelines/stage-edits.ts";
import { publishingLabel } from "../../shell/project-words.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { NOT_STARTED } from "../../shell/work/work-words.ts";
import { useRecordChange } from "./planning-parts.tsx";
import { STAGE_STATE_WORDS } from "./stage-words.ts";

/**
 * "Edit for this Task": the Stage editor on the Task's own copy of its Pipeline, and the Pipeline
 * swapped for another while the Task hasn't started. The library Pipeline stays as it is.
 */
export function EditTaskStagesDialog({
  task,
  onClose,
}: {
  readonly task: Task;
  readonly onClose: () => void;
}): ReactNode {
  const taskStages = useQuery(pipelineQueries.taskStages(task.id));
  const library = useQuery(pipelineQueries.list());
  const roles = useQuery(roleQueries.list());
  const options = useQuery(roleCardQueries.options());
  const project = useQuery(projectQueries.one(task.projectId));
  if (!taskStages.data || !library.data || !roles.data || !options.data || !project.data) {
    return null;
  }
  return (
    <EditTaskStagesForm
      // A swapped Pipeline starts the edit again from its Stages.
      key={task.pipelineId}
      task={task}
      taskStages={taskStages.data}
      library={library.data}
      roles={roles.data}
      options={options.data}
      project={project.data}
      onClose={onClose}
    />
  );
}

function EditTaskStagesForm({
  task,
  taskStages,
  library,
  roles,
  options,
  project,
  onClose,
}: {
  readonly task: Task;
  readonly taskStages: TaskStages;
  readonly library: readonly Pipeline[];
  readonly roles: readonly Role[];
  readonly options: RoleCardOptions;
  readonly project: Project;
  readonly onClose: () => void;
}): ReactNode {
  const pipeline = library.find(({ id }) => id === task.pipelineId);
  const [stages, setStages] = useState<readonly Stage[]>(
    () => taskStages.stages?.map(({ stage }) => stage) ?? pipeline?.stages ?? [],
  );
  const [edited, setEdited] = useState(false);
  const check = useQuery({
    ...pipelineQueries.stagesCheck(task.id, stages),
    placeholderData: keepPreviousData,
  });
  const problems = check.data?.problems ?? [];
  const queryClient = useQueryClient();
  const showToast = useToast();
  const saving = useMutation({
    mutationFn: () => editTaskStages(task.id, stages),
    onSuccess: (saved) => {
      queryClient.setQueryData(pipelineQueries.taskStages(task.id).queryKey, saved);
      showToast(`Stages saved for ${task.title}.`);
      onClose();
    },
  });
  const swapping = useRecordChange(task, async (pipelineId: string) => {
    const swapped = await setPipeline(task.id, pipelineId);
    // The edit starts again from the new Pipeline's Stages once the Task's own are set aside.
    await queryClient.invalidateQueries(pipelineQueries.taskStages(task.id));
    return swapped;
  });
  const notStarted = NOT_STARTED.includes(task.state);
  const lockedNotes = (taskStages.stages ?? [])
    .slice(0, taskStages.lockedStages)
    .map(({ state }) => `${STAGE_STATE_WORDS[state]}: started, so it can't be changed`);
  return (
    <Dialog
      title={`Stages of ${task.title}`}
      width={760}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={saving.isPending}
            disabled={!edited || problems.length > 0 || check.isFetching}
            onClick={() => saving.mutate()}
          >
            Save for this Task
          </Button>
        </>
      }
    >
      <div className="work-form edit-task-stages">
        <Alert tone="info">
          Changes apply to <b>{task.title}</b> only.{" "}
          {pipeline
            ? `The library's ${pipeline.name} Pipeline stays as it is.`
            : "Its Pipeline was removed from the library."}
          {lockedNotes.length > 0 && " Stages already started are locked."}
        </Alert>
        {notStarted && (
          <Select
            label="Pipeline"
            hint="Another Pipeline brings its own Stages, and sets aside those edited for this Task."
            value={task.pipelineId}
            disabled={swapping.isPending}
            options={library.map(({ id, name }) => ({ value: id, label: name }))}
            onChange={(pipelineId) => swapping.mutate(pipelineId)}
          />
        )}
        {swapping.error && (
          <RefusalAlert title="The Pipeline wasn't swapped" error={swapping.error} />
        )}
        {saving.error && <RefusalAlert title="The Stages weren't saved" error={saving.error} />}
        <StageEditor
          stages={stages}
          onChange={(changed) => {
            setStages(changed);
            setEdited(true);
          }}
          lockedNotes={lockedNotes}
          problems={problems}
          roles={roles}
          options={options}
          commandLines={commandLinesOf(project)}
        />
      </div>
    </Dialog>
  );
}

function commandLinesOf(project: Project): Readonly<Record<StageCommand, string>> {
  const { build, lint, test } = project.commands;
  return {
    build,
    lint,
    test,
    publish: publishingLabel(project.publishingMode, project.baseBranch).toLowerCase(),
  };
}

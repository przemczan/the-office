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
import { checkAwaited } from "../../shell/pipelines/stages-check.ts";
import { publishingLabel } from "../../shell/project-words.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { NOT_STARTED } from "../../shell/work/work-words.ts";
import { useRecordChange } from "./planning-parts.tsx";
import { STAGE_STATE_WORDS } from "./stage-words.ts";

/**
 * "Edit for this Task": the Stage editor on the Task's own copy of its Pipeline, and the Pipeline
 * swapped for another while the Task hasn't started. All of it is a draft until Save; closing the
 * window drops it. The library Pipeline stays as it is.
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
  const stagesOf = (pipelineId: string): readonly Stage[] =>
    (pipelineId === task.pipelineId ? taskStages.stages?.map(({ stage }) => stage) : undefined) ??
    library.find(({ id }) => id === pipelineId)?.stages ??
    [];
  const [chosenPipelineId, setChosenPipelineId] = useState(task.pipelineId);
  const [stages, setStages] = useState(() => stagesOf(task.pipelineId));
  const [edited, setEdited] = useState(false);
  const pipeline = library.find(({ id }) => id === chosenPipelineId);
  const swapped = chosenPipelineId !== task.pipelineId;
  const check = useQuery({
    ...pipelineQueries.stagesCheck(task.id, stages),
    placeholderData: keepPreviousData,
  });
  const problems = check.data?.problems ?? [];
  const queryClient = useQueryClient();
  const showToast = useToast();
  const swapping = useRecordChange(task, async (pipelineId: string) => {
    const changed = await setPipeline(task.id, pipelineId);
    // The swap sets aside the Task's own Stages.
    await queryClient.invalidateQueries(pipelineQueries.taskStages(task.id));
    return changed;
  });
  const saving = useMutation({
    mutationFn: async () => {
      // In this order: the swap resets the Task's own Stages, so an edit saved before it would go.
      if (swapped) await swapping.mutateAsync(chosenPipelineId);
      // A swap alone keeps the Task following the library, so it saves no Stages of its own.
      if (edited) {
        const saved = await editTaskStages(task.id, stages);
        queryClient.setQueryData(pipelineQueries.taskStages(task.id).queryKey, saved);
      }
    },
    onSuccess: () => {
      showToast(`Stages saved for ${task.title}.`);
      onClose();
    },
  });
  const notStarted = NOT_STARTED.includes(task.state);
  const editWaits = edited && (problems.length > 0 || checkAwaited(check));
  const lockedNotes = (taskStages.stages ?? [])
    .slice(0, taskStages.lockedStages)
    .map(({ state }) => `${STAGE_STATE_WORDS[state]}: started, so it can't be changed`);
  return (
    <Dialog
      size="medium"
      title={`Stages of ${task.title}`}
      onClose={onClose}
      actions={
        <>
          <Button
            loading={saving.isPending}
            disabled={(!edited && !swapped) || editWaits}
            onClick={() => saving.mutate()}
          >
            Save for this Task
          </Button>
          <span className="dialog-hint">Nothing changes on the Task until you save.</span>
        </>
      }
    >
      <div className="work-form">
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
            hint="Another Pipeline brings its own Stages. Saving it sets aside those edited for this Task."
            value={chosenPipelineId}
            disabled={saving.isPending}
            options={library.map(({ id, name }) => ({ value: id, label: name }))}
            onChange={(pipelineId) => {
              setChosenPipelineId(pipelineId);
              setStages(stagesOf(pipelineId));
              setEdited(false);
            }}
          />
        )}
        {saving.error && (
          <RefusalAlert
            title={swapping.error ? "The Pipeline wasn't swapped" : "The Stages weren't saved"}
            error={saving.error}
          />
        )}
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

/** What each Script Stage's command runs in the Project: its line by key, or how Publish ships. */
function commandLinesOf(project: Project): Readonly<Record<StageCommand, string>> {
  const lineOf = (key: string): string =>
    project.commands.find((command) => command.key === key)?.commandLine ?? "";
  return {
    build: lineOf("build"),
    lint: lineOf("lint"),
    test: lineOf("test"),
    publish: publishingLabel(project.publishingMode, project.baseBranch).toLowerCase(),
  };
}

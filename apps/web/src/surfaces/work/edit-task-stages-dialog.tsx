import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Duty,
  Initiative,
  Project,
  Role,
  RoleCardOptions,
  Stage,
  TaskStages,
  TaskSummary,
} from "@the-office/contracts";
import { Alert, Button, Dialog } from "@the-office/ui";
import { useMemo, useState, type ReactNode } from "react";
import { dutyQueries, roleCardQueries, roleQueries } from "../../api/people.ts";
import { editTaskStages, pipelineQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { initiativeQueries, setPipeline } from "../../api/work.ts";
import {
  choiceById,
  openingChoice,
  taskPipelineChoices,
  type PipelineChoiceGroup,
} from "../../shell/pipelines/pipeline-choices.ts";
import { PipelinePicker } from "../../shell/pipelines/pipeline-picker.tsx";
import { asWholeFlow } from "../../shell/pipelines/flow/flow-model.ts";
import { TaskFlowEditor } from "../../shell/pipelines/flow/task-flow-editor.tsx";
import type { StageCommandSource } from "../../shell/pipelines/stage-commands.ts";
import { byLevel, checkAwaited } from "../../shell/pipelines/stages-check.ts";
import { useProjectPipelineChoices } from "../../shell/pipelines/use-pipelines.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { NOT_STARTED } from "../../shell/work/work-words.ts";
import { useRecordChange } from "./planning-parts.tsx";
import { STAGE_STATE_WORDS } from "./stage-words.ts";
import { taskPublishingWords } from "./task-publishing.ts";

/**
 * "Edit for this Task": the flow editor on the Task's own copy of its Pipeline, and the Pipeline
 * swapped for another its Project can follow while the Task hasn't started. All of it is a draft
 * until Save; closing the window drops it. The Pipeline itself stays as it is.
 */
export function EditTaskStagesDialog({
  task,
  onClose,
}: {
  readonly task: TaskSummary;
  readonly onClose: () => void;
}): ReactNode {
  const taskStages = useQuery(pipelineQueries.taskStages(task.id));
  const library = useProjectPipelineChoices(task.projectId);
  const roles = useQuery(roleQueries.list());
  const duties = useQuery(dutyQueries.list());
  const options = useQuery(roleCardQueries.options());
  const project = useQuery(projectQueries.one(task.projectId));
  const initiative = useQuery({
    ...initiativeQueries.one(task.initiativeId ?? ""),
    enabled: task.initiativeId !== null,
  });
  if (
    !taskStages.data ||
    !library ||
    !roles.data ||
    !duties.data ||
    !options.data ||
    !project.data
  ) {
    return null;
  }
  const groups = taskPipelineChoices(
    project.data,
    library.officeWide,
    library.projectPipelines,
    task.kind,
  );
  if (task.initiativeId !== null && !initiative.data) return null;
  return (
    <EditTaskStagesForm
      task={task}
      taskStages={taskStages.data}
      groups={groups}
      roles={roles.data}
      duties={duties.data}
      options={options.data}
      project={project.data}
      initiative={initiative.data}
      onClose={onClose}
    />
  );
}

/**
 * The Stages as a draft until Save. A Task with no Pipeline yet (spec 2.1) starts with none chosen,
 * the Project's default listed first, and shows the Stages of the one chosen to edit at once; Save
 * sets the Pipeline, then saves the Stages if they were edited.
 */
function EditTaskStagesForm({
  task,
  taskStages,
  groups,
  roles,
  duties,
  options,
  project,
  initiative,
  onClose,
}: {
  readonly task: TaskSummary;
  readonly taskStages: TaskStages;
  /** What the Task may follow instead: its Project's own Pipelines, then the office-wide ones. */
  readonly groups: readonly PipelineChoiceGroup[];
  readonly roles: readonly Role[];
  readonly duties: readonly Duty[];
  readonly options: RoleCardOptions;
  readonly project: Project;
  /** The Initiative the Task is part of, if it is. */
  readonly initiative: Initiative | undefined;
  readonly onClose: () => void;
}): ReactNode {
  const stagesOf = (pipelineId: string): readonly Stage[] =>
    asWholeFlow(
      (pipelineId === task.pipelineId ? taskStages.stages?.map(({ stage }) => stage) : undefined) ??
        choiceById(groups, pipelineId)?.stages ??
        [],
    );
  // "" while a Task with no Pipeline has none chosen yet.
  const followed = task.pipelineId ?? "";
  const notChosen = task.pipelineId === null;
  // With none chosen yet, it opens on its Kind's default, so one press chooses it.
  const [opening] = useState(() => (notChosen ? (openingChoice(groups)?.id ?? "") : followed));
  const [chosenPipelineId, setChosenPipelineId] = useState(opening);
  const [stages, setStages] = useState(() => stagesOf(opening));
  const [edited, setEdited] = useState(false);
  const pipeline = choiceById(groups, chosenPipelineId);
  const swapped = chosenPipelineId !== followed;
  const check = useQuery({
    ...pipelineQueries.stagesCheck(task.id, stages, chosenPipelineId),
    enabled: chosenPipelineId !== "",
    placeholderData: keepPreviousData,
  });
  const { problems, warnings } = byLevel(check.data?.problems);
  const queryClient = useQueryClient();
  const showToast = useToast();
  const swapping = useRecordChange(task, async (pipelineId: string) => {
    const changed = await setPipeline(task.id, pipelineId);
    // The swap sets aside the Task's own Stages.
    await queryClient.invalidateQueries(pipelineQueries.taskStages(task.id));
    return changed;
  });
  const saving = useMutation({
    // Answers the toast's words for what it did, as the Task it was given changes as it goes.
    mutationFn: async (): Promise<string> => {
      // In this order: the swap resets the Task's own Stages, so an edit saved before it would go.
      if (swapped) await swapping.mutateAsync(chosenPipelineId);
      // A swap alone keeps the Task following the library, so it saves no Stages of its own.
      if (edited) {
        const saved = await editTaskStages(task.id, stages);
        queryClient.setQueryData(pipelineQueries.taskStages(task.id).queryKey, saved);
      }
      return notChosen
        ? `${task.title} follows ${pipeline?.name ?? chosenPipelineId}.`
        : `Stages saved for ${task.title}.`;
    },
    onSuccess: (words) => {
      showToast(words);
      onClose();
    },
  });
  const notStarted = NOT_STARTED.includes(task.state);
  const editWaits = edited && (problems.length > 0 || checkAwaited(check));
  const started = useMemo(() => startedStages(taskStages), [taskStages]);
  // In the window's bar, and under the editor in full screen, so Save stays at hand.
  const saveActions = (
    <>
      <Button
        loading={saving.isPending}
        disabled={(!edited && !swapped) || editWaits}
        title={chosenPipelineId === "" ? "Choose a Pipeline first." : undefined}
        onClick={() => saving.mutate()}
      >
        Save for this Task
      </Button>
      <span className="dialog-hint">Nothing changes on the Task until you save.</span>
    </>
  );
  return (
    <Dialog
      size="large"
      keepsHeight
      title={notChosen ? `Choose a Pipeline for ${task.title}` : `Stages of ${task.title}`}
      unsavedChanges={edited || chosenPipelineId !== opening}
      onClose={onClose}
      actions={saveActions}
    >
      <div className="work-form">
        {(pipeline || !notChosen) && (
          <Alert tone="info">
            Changes apply to <b>{task.title}</b> only.{" "}
            {pipeline
              ? `The ${pipeline.name} Pipeline itself stays as it is.`
              : "Its Pipeline was removed from the library."}
            {started.size > 0 && " Started Stages, and the routes out of them, are locked."}
          </Alert>
        )}
        {notStarted && (
          <PipelinePicker
            placeholder={notChosen ? "Choose a Pipeline" : undefined}
            hint={
              notChosen
                ? "Its Stages show below, to edit for this Task before you save."
                : "Another Pipeline brings its own Stages. Saving it sets aside those edited for this Task."
            }
            value={chosenPipelineId}
            groups={groups}
            disabled={saving.isPending}
            onChange={(pipelineId) => {
              setChosenPipelineId(pipelineId);
              setStages(stagesOf(pipelineId));
              setEdited(false);
            }}
          />
        )}
        {saving.error && (
          <RefusalAlert
            title={
              swapping.error
                ? notChosen
                  ? "The Pipeline wasn't chosen"
                  : "The Pipeline wasn't swapped"
                : "The Stages weren't saved"
            }
            error={saving.error}
          />
        )}
        {chosenPipelineId !== "" && (
          <TaskFlowEditor
            // Another Pipeline opens at 100%, with its Start in view.
            key={chosenPipelineId}
            stages={stages}
            onChange={(changed) => {
              setStages(changed);
              setEdited(true);
            }}
            started={started}
            problems={problems}
            warnings={warnings}
            roles={roles}
            duties={duties}
            options={options}
            commands={commandsOf(task, project, initiative)}
            fullScreenName={`${task.title} ·`}
            fullScreenBar={saveActions}
          />
        )}
      </div>
    </Dialog>
  );
}

/** The Stages that have started, any run making one so, by key with their state's words. */
function startedStages({ stages }: TaskStages): ReadonlyMap<string, string> {
  return new Map(
    (stages ?? [])
      .filter(({ runs }) => runs.length > 0)
      .map(({ stage, state }): [string, string] => [stage.key, STAGE_STATE_WORDS[state]]),
  );
}

/** What a Script Stage may run in the Task's Project: its commands, and Publish as it ships there. */
function commandsOf(
  task: TaskSummary,
  project: Project,
  initiative: Initiative | undefined,
): StageCommandSource {
  return {
    kind: "project",
    commands: project.commands,
    publishing: taskPublishingWords(task, project, initiative),
    publishingLines: project,
  };
}

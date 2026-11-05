import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Pipeline, PipelineEdit, Role, RoleCardOptions } from "@the-office/contracts";
import { Button, Card, Dialog, Input, Textarea } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import {
  addPipeline,
  pipelineQueries,
  removePipeline,
  savePipeline,
} from "../../../api/pipelines.ts";
import { StageEditor } from "../../../shell/pipelines/stage-editor.tsx";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";

const NEW_PIPELINE: PipelineEdit = { name: "", description: "", stages: [] };

/**
 * The open library Pipeline's name, description and Stages in the shared Stage editor, saved or
 * discarded as a whole; a new Pipeline is added the same way. Problems the service would refuse
 * hold Save; a Role nobody fills is only flagged.
 */
export function LibraryPipelineForm({
  pipeline,
  roles,
  options,
  onDone,
}: {
  /** Undefined while the user makes a new Pipeline. */
  readonly pipeline: Pipeline | undefined;
  readonly roles: readonly Role[];
  readonly options: RoleCardOptions;
  /** Told once a new Pipeline is added, or its making is given up. */
  readonly onDone: () => void;
}): ReactNode {
  const saved = pipeline ? editOf(pipeline) : NEW_PIPELINE;
  const [draft, setDraft] = useState<PipelineEdit>(saved);
  const [removing, setRemoving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const check = useQuery({
    ...pipelineQueries.libraryCheck({ ...draft, pipelineId: pipeline?.id }),
    placeholderData: keepPreviousData,
  });
  const problems = check.data?.problems ?? [];
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const showToast = useToast();
  const saving = useMutation({
    mutationFn: () => (pipeline ? savePipeline(pipeline.id, draft) : addPipeline(draft)),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries(pipelineQueries.list());
      if (pipeline) {
        setDraft(editOf(result));
        showToast("Pipeline saved. Tasks not started yet follow it; running ones keep their copy.");
        return;
      }
      showToast(`${result.name} added to the library.`);
      onDone();
      await navigate({ to: "/settings/pipelines/$pipelineId", params: { pipelineId: result.id } });
    },
  });
  const change = (changed: Partial<PipelineEdit>): void => setDraft({ ...draft, ...changed });
  return (
    <>
      <Card>
        <div className="library-form">
          <Input
            label="Name"
            value={draft.name}
            onChange={(event) => change({ name: event.target.value })}
          />
          <Textarea
            label="Description"
            rows={2}
            value={draft.description}
            onChange={(event) => change({ description: event.target.value })}
          />
          <StageEditor
            stages={draft.stages}
            onChange={(stages) => change({ stages: [...stages] })}
            lockedNotes={[]}
            problems={problems}
            flags={check.data?.flags ?? []}
            problemsTitle="The Pipeline can't be saved yet"
            roles={roles}
            options={options}
          />
        </div>
      </Card>
      {saving.error && <RefusalAlert title="The Pipeline wasn't saved" error={saving.error} />}
      <div className="settings-actions">
        <span className="settings-actions-state">
          {pipeline ? (dirty ? "Unsaved changes" : "Saved") : "Not in the library yet"}
        </span>
        {pipeline && (
          <Button variant="danger-ghost" onClick={() => setRemoving(true)}>
            Remove
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={pipeline !== undefined && !dirty}
          onClick={() => (pipeline ? setDraft(saved) : onDone())}
        >
          Discard
        </Button>
        <Button
          loading={saving.isPending}
          disabled={!dirty || problems.length > 0 || check.isFetching}
          onClick={() => saving.mutate()}
        >
          {pipeline ? "Save the Pipeline" : "Add the Pipeline"}
        </Button>
      </div>
      {removing && pipeline && (
        <RemovePipelineDialog pipeline={pipeline} onClose={() => setRemoving(false)} />
      )}
    </>
  );
}

/**
 * Removing asks first; the service refuses while a Project's default or a Task that hasn't started
 * uses the Pipeline, and always for Onboard, and the dialog shows why.
 */
function RemovePipelineDialog({
  pipeline,
  onClose,
}: {
  readonly pipeline: Pipeline;
  readonly onClose: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const showToast = useToast();
  const removing = useMutation({
    mutationFn: () => removePipeline(pipeline.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries(pipelineQueries.list());
      showToast(`${pipeline.name} removed from the library.`);
      onClose();
      await navigate({ to: "/settings/pipelines" });
    },
  });
  return (
    <Dialog
      size="small"
      title={`Remove ${pipeline.name}?`}
      onClose={onClose}
      actions={
        <Button variant="danger" loading={removing.isPending} onClick={() => removing.mutate()}>
          Remove the Pipeline
        </Button>
      }
    >
      <div className="dialog-stack">
        <p className="dialog-text">
          Running and finished Tasks keep the copy of its Stages they started with.
        </p>
        {removing.error && (
          <RefusalAlert title={`${pipeline.name} can't be removed`} error={removing.error} />
        )}
      </div>
    </Dialog>
  );
}

function editOf({ name, description, stages }: Pipeline): PipelineEdit {
  return { name, description, stages };
}

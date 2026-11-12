import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Pipeline, PipelineEdit, Role, RoleCardOptions } from "@the-office/contracts";
import { Alert, Button, Card, Input, Textarea } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import {
  addPipeline,
  pipelineQueries,
  removePipeline,
  savePipeline,
} from "../../../api/pipelines.ts";
import { projectQueries } from "../../../api/projects.ts";
import { useLibraryCommands } from "../../../shell/pipelines/library-commands.ts";
import { RemovePipelineDialog } from "../../../shell/pipelines/remove-pipeline-dialog.tsx";
import { StageEditor } from "../../../shell/pipelines/stage-editor.tsx";
import { checkAwaited } from "../../../shell/pipelines/stages-check.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { BreaksDialog } from "./breaks-dialog.tsx";
import { breaksSentence, breaksTitle } from "./breaks-words.ts";

const NEW_PIPELINE: PipelineEdit = { name: "", description: "", stages: [] };

/**
 * The open library Pipeline's name, description and Stages in the shared Stage editor, saved or
 * discarded as a whole; a new Pipeline is added the same way. Problems the service would refuse
 * hold Save; a Role nobody fills is only flagged. A save that would break Project Pipelines built
 * from it warns above the bar, and Save asks first in a window naming them (spec §2.3, "A Broken
 * Project Pipeline").
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
  const [warning, setWarning] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const check = useQuery({
    ...pipelineQueries.libraryCheck({ ...draft, pipelineId: pipeline?.id }),
    placeholderData: keepPreviousData,
  });
  const problems = check.data?.problems ?? [];
  const breaks = dirty ? (check.data?.breaks ?? []) : [];
  const projects = useQuery(projectQueries.list()).data ?? [];
  const commands = useLibraryCommands();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const showToast = useToast();
  const saving = useMutation({
    mutationFn: () => (pipeline ? savePipeline(pipeline.id, draft) : addPipeline(draft)),
    // The refusal shows above the save bar, so the warning window closes either way.
    onSettled: () => setWarning(false),
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
            commands={commands}
          />
        </div>
      </Card>
      {breaks.length > 0 && (
        <Alert tone="warning" title={breaksTitle(undefined, breaks.length)}>
          {breaksSentence(breaks)} name Stages this edit takes out of {pipeline?.name}. You can save
          anyway: each is then Broken until its Stage changes are fixed.
        </Alert>
      )}
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
          disabled={!dirty || problems.length > 0 || checkAwaited(check)}
          onClick={() => (breaks.length > 0 ? setWarning(true) : saving.mutate())}
        >
          {pipeline ? "Save the Pipeline" : "Add the Pipeline"}
        </Button>
      </div>
      {warning && pipeline && (
        <BreaksDialog
          pipelineName={pipeline.name}
          breaks={breaks}
          projects={projects}
          saving={saving.isPending}
          onSaveAnyway={() => saving.mutate()}
          onClose={() => setWarning(false)}
        />
      )}
      {removing && pipeline && (
        <RemovePipelineDialog
          name={pipeline.name}
          remove={() => removePipeline(pipeline.id)}
          removedToast={`${pipeline.name} removed from the library.`}
          onRemoved={async () => {
            await queryClient.invalidateQueries(pipelineQueries.list());
            await navigate({ to: "/settings/pipelines" });
          }}
          onClose={() => setRemoving(false)}
        />
      )}
    </>
  );
}

function editOf({ name, description, stages }: Pipeline): PipelineEdit {
  return { name, description, stages };
}

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { Duty, Pipeline, PipelineEdit, Role, RoleCardOptions } from "@the-office/contracts";
import { Button, Card, Input, Textarea, Tooltip } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { applyProposal, proposalQueries } from "../../../api/conversations.ts";
import {
  addPipeline,
  pipelineQueries,
  refreshPipelineList,
  removePipeline,
  savePipeline,
} from "../../../api/pipelines.ts";
import { useLibraryCommands } from "../../../shell/pipelines/library-commands.ts";
import { RemovePipelineDialog } from "../../../shell/pipelines/remove-pipeline-dialog.tsx";
import { ConvertedNote } from "../../../shell/pipelines/flow/converted-note.tsx";
import { flowProblems } from "../../../shell/pipelines/flow/flow-checks.ts";
import { asFlow } from "../../../shell/pipelines/flow/flow-model.ts";
import { OfficeFlowEditor } from "../../../shell/pipelines/flow/office-flow-editor.tsx";
import { byLevel, checkAwaited } from "../../../shell/pipelines/stages-check.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import type { ProposedLibraryEdit } from "./proposed-library-edit.ts";

const NEW_PIPELINE: PipelineEdit = { name: "", description: "", stages: [] };

/**
 * The open library Pipeline's name, description and Stages in the flow editor, saved or discarded
 * as a whole; a new Pipeline is added the same way. Problems the service would refuse
 * hold Save; a Role nobody fills is only flagged.
 */
export function LibraryPipelineForm({
  pipeline,
  roles,
  duties,
  options,
  proposed,
  onDone,
}: {
  /** Undefined while the user makes a new Pipeline. */
  readonly pipeline: Pipeline | undefined;
  readonly roles: readonly Role[];
  readonly duties: readonly Duty[];
  readonly options: RoleCardOptions;
  /** The Proposal "Edit before applying" opened: its Pipeline starts the draft, and saving applies it. */
  readonly proposed?: Extract<ProposedLibraryEdit, { kind: "pipeline" }>;
  /** Told once a new Pipeline is added, or its making is given up. */
  readonly onDone: () => void;
}): ReactNode {
  const saved = pipeline ? editOf(pipeline) : NEW_PIPELINE;
  const [draft, setDraft] = useState<PipelineEdit>(proposed?.edit ?? saved);
  const [removing, setRemoving] = useState(false);
  const dirty = proposed !== undefined || JSON.stringify(draft) !== JSON.stringify(saved);
  const check = useQuery({
    ...pipelineQueries.libraryCheck({ ...draft, pipelineId: pipeline?.id }),
    placeholderData: keepPreviousData,
  });
  const { problems, warnings } = byLevel([
    ...(check.data?.problems ?? []),
    ...flowProblems(draft.stages),
  ]);
  const commands = useLibraryCommands();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { stage: pickedStage } = useSearch({ strict: false });
  const showToast = useToast();
  const saving = useMutation({
    mutationFn: () => (pipeline ? savePipeline(pipeline.id, draft) : addPipeline(draft)),
    onSuccess: async (result) => {
      await refreshPipelineList(queryClient);
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
  const applying = useMutation({
    mutationFn: async () => {
      if (!proposed) return;
      await applyProposal(proposed.proposal.id, { actionInput: { ...draft } });
      await queryClient.invalidateQueries(proposalQueries.one(proposed.proposal.id));
      await refreshPipelineList(queryClient);
    },
    onSuccess: async () => {
      showToast(`${draft.name} ${proposed?.recordId ? "saved" : "added to the library"}.`);
      onDone();
      await navigate(
        proposed?.recordId
          ? { to: "/settings/pipelines/$pipelineId", params: { pipelineId: proposed.recordId } }
          : { to: "/settings/pipelines" },
      );
    },
  });
  const submit = proposed ? applying : saving;
  const change = (changed: Partial<PipelineEdit>): void => setDraft({ ...draft, ...changed });
  // Under the form, and under the editor in full screen, so Save stays at hand.
  const saveRow = (withRemove: boolean): ReactNode => (
    <>
      <span className="settings-actions-state">
        {saveState(pipeline !== undefined, dirty, problems.length, proposed !== undefined)}
      </span>
      {withRemove && pipeline && (
        <Button variant="danger-ghost" onClick={() => setRemoving(true)}>
          Remove
        </Button>
      )}
      <Button
        variant="secondary"
        disabled={pipeline !== undefined && !dirty}
        onClick={() => (proposed ? setDraft(proposed.edit) : pipeline ? setDraft(saved) : onDone())}
      >
        Discard
      </Button>
      <HeldSave count={problems.length}>
        <Button
          loading={submit.isPending}
          disabled={!dirty || problems.length > 0 || checkAwaited(check)}
          onClick={() => submit.mutate()}
        >
          {proposed ? "Apply the Proposal" : pipeline ? "Save the Pipeline" : "Add the Pipeline"}
        </Button>
      </HeldSave>
    </>
  );
  return (
    <>
      {pipeline && (
        <ConvertedNote
          key={pipeline.id}
          pipelineId={pipeline.id}
          name={pipeline.name}
          stages={draft.stages}
        />
      )}
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
          <OfficeFlowEditor
            stages={draft.stages}
            endPosition={draft.endPosition}
            onChange={(stages, endPosition) => change({ stages: [...stages], endPosition })}
            problems={problems}
            warnings={warnings}
            roles={roles}
            duties={duties}
            options={options}
            commands={commands}
            fullScreenName={`${draft.name || "New Pipeline"} ·`}
            fullScreenBar={saveRow(false)}
            pickedStage={pickedStage}
          />
        </div>
      </Card>
      {submit.error && <RefusalAlert title="The Pipeline wasn't saved" error={submit.error} />}
      <div className="settings-actions">{saveRow(true)}</div>
      {removing && pipeline && (
        <RemovePipelineDialog
          name={pipeline.name}
          remove={() => removePipeline(pipeline.id)}
          removedToast={`${pipeline.name} removed from the library.`}
          onRemoved={async () => {
            await refreshPipelineList(queryClient);
            await navigate({ to: "/settings/pipelines" });
          }}
          onClose={() => setRemoving(false)}
        />
      )}
    </>
  );
}

/** The Pipeline as the editor holds it: its Stages a flow, each with its position and routes. */
function editOf({ name, description, stages, endPosition }: Pipeline): PipelineEdit {
  return { name, description, stages: [...asFlow(stages)], ...(endPosition && { endPosition }) };
}

/** "2 problems hold Save" while one stands; otherwise whether there is anything to save. */
function saveState(
  inLibrary: boolean,
  dirty: boolean,
  problems: number,
  proposed: boolean,
): string {
  if (problems > 0) return `${problems} ${problems === 1 ? "problem holds" : "problems hold"} Save`;
  if (proposed) return "Proposed; applies as you edit it here";
  if (!inLibrary) return "Not in the library yet";
  return dirty ? "Unsaved changes" : "Saved";
}

/** Save, disabled while problems stand, says why on hover and focus. */
function HeldSave({
  count,
  children,
}: {
  readonly count: number;
  readonly children: ReactNode;
}): ReactNode {
  if (count === 0) return children;
  return (
    <Tooltip
      focusable
      content={`Fix ${count === 1 ? "the problem" : `the ${count} problems`} above first: Save waits while one stands`}
    >
      {children}
    </Tooltip>
  );
}

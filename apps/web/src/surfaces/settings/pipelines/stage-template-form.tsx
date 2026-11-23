import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type {
  Duty,
  LinkedStage,
  Role,
  RoleCardOptions,
  Stage,
  StageTemplate,
} from "@the-office/contracts";
import { Button, Card, Dialog, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import {
  addStageTemplate,
  refreshStageTemplateList,
  removeStageTemplate,
  saveStageTemplate,
  stageTemplateQueries,
} from "../../../api/pipelines.ts";
import { AskDevopsButton } from "../../../shell/ask-devops.tsx";
import { ApplyTemplateEditDialog } from "../../../shell/pipelines/apply-template-edit-dialog.tsx";
import { StageCheckAlerts } from "../../../shell/pipelines/stage-check-alerts.tsx";
import { useLibraryCommands } from "../../../shell/pipelines/library-commands.ts";
import {
  STAGE_KIND_ICONS,
  STAGE_KIND_NAMES,
  standaloneStage,
  type StageKind,
} from "../../../shell/pipelines/stage-edits.ts";
import { StageForm } from "../../../shell/pipelines/stage-form.tsx";
import { byLevel, checkAwaited } from "../../../shell/pipelines/stages-check.ts";
import { fieldsChanged, stageCount } from "../../../shell/pipelines/template-link.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { LinkedStagesCard } from "./linked-stages-card.tsx";

/** Where a new Stage template starts: the kind the user picked, or the template opened. */
export type StageTemplateOpened =
  | { readonly template: StageTemplate }
  | { readonly template?: undefined; readonly kind: StageKind };

/**
 * The open Stage template in the Stage editor's own form, saved or discarded as a whole; a new one
 * is added the same way. Problems the service would refuse hold Save; a Role nobody fills is only
 * flagged. A template has no "On failure": going back names a Stage only a Pipeline has. A draft
 * with no changes follows the saved template, so one changed elsewhere, such as by a Proposal
 * applied in a chat, shows as saved. Saving an edit of its fields while Stages are linked to it
 * first asks which of them get it; an edit of only its name saves at once.
 */
export function StageTemplateForm({
  opened,
  roles,
  duties,
  options,
  onDone,
}: {
  readonly opened: StageTemplateOpened;
  readonly roles: readonly Role[];
  readonly duties: readonly Duty[];
  readonly options: RoleCardOptions;
  /** Told once a new template is added, or its making is given up. */
  readonly onDone: () => void;
}): ReactNode {
  const { template } = opened;
  const saved = template ? template.stage : standaloneStage(opened.kind);
  const savedText = JSON.stringify(saved);
  const [draft, setDraft] = useState<Stage>(saved);
  const [followed, setFollowed] = useState(savedText);
  // Counts the times the draft followed the saved template, to start the fields' own typing over.
  const [follows, setFollows] = useState(0);
  if (followed !== savedText) {
    setFollowed(savedText);
    if (JSON.stringify(draft) === followed) {
      setDraft(saved);
      setFollows(follows + 1);
    }
  }
  const [removing, setRemoving] = useState(false);
  const [applyingTo, setApplyingTo] = useState<readonly LinkedStage[] | undefined>();
  const dirty = JSON.stringify(draft) !== savedText;
  const check = useQuery({
    ...stageTemplateQueries.check({ stage: draft, stageTemplateId: template?.id }),
    placeholderData: keepPreviousData,
  });
  const { problems, warnings } = byLevel(check.data?.problems);
  const commands = useLibraryCommands();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const showToast = useToast();
  const saving = useMutation({
    mutationFn: () => (template ? saveStageTemplate(template.id, draft) : addStageTemplate(draft)),
    onSuccess: async (result) => {
      await refreshStageTemplateList(queryClient);
      if (template) {
        setDraft(result.stage);
        showToast(`${result.stage.name} saved.`);
        return;
      }
      showToast(`${result.stage.name} added to the Stage templates.`);
      onDone();
      await navigate({
        to: "/settings/pipelines/stage-templates/$stageTemplateId",
        params: { stageTemplateId: result.id },
      });
    },
  });
  // The linked Stages, read as Save is pressed: only an edit of the template's fields asks.
  const asking = useMutation({
    mutationFn: (linkedTo: StageTemplate) =>
      queryClient.fetchQuery(stageTemplateQueries.linkedStages(linkedTo.id)),
    onSuccess: (linked) => {
      if (linked.length > 0) setApplyingTo(linked);
      else saving.mutate();
    },
  });
  const save = (): void => {
    if (template && fieldsChanged(template.stage, draft).length > 0) asking.mutate(template);
    else saving.mutate();
  };
  const name = draft.name.trim() || "New Stage template";
  return (
    <>
      <Card
        title={
          <span className="settings-block-title">
            <Icon name={STAGE_KIND_ICONS[draft.kind]} size={15} strokeWidth={1.6} />
            {name}
          </span>
        }
        actions={
          template && (
            <AskDevopsButton
              label={(person) => `Ask ${person}`}
              draft={`Can you propose a change to the ${template.stage.name} Stage template? `}
            />
          )
        }
      >
        <p className="settings-note">
          {STAGE_KIND_NAMES[draft.kind]} template. A Stage added from it to a Pipeline stays linked
          to it, and an edit applies to the linked Stages you choose; added to a Task's own Stages,
          it is a copy.
        </p>
        <div className="library-form">
          <StageCheckAlerts
            problems={problems}
            warnings={warnings}
            problemsTitle="The Stage template can't be saved yet"
          />
          <StageForm
            key={follows}
            stages={[draft]}
            index={0}
            onChange={([changed]) => changed && setDraft(changed)}
            roles={roles}
            duties={duties}
            options={options}
            commands={commands}
          />
        </div>
      </Card>
      {template && <LinkedStagesCard template={template} />}
      {asking.error && (
        <RefusalAlert title="The linked Stages can't be read" error={asking.error} />
      )}
      {saving.error && (
        <RefusalAlert title="The Stage template wasn't saved" error={saving.error} />
      )}
      <div className="settings-actions">
        <span className="settings-actions-state">
          {template ? (dirty ? "Unsaved changes" : "Saved") : "Not in the Stage templates yet"}
        </span>
        {template && (
          <Button variant="danger-ghost" onClick={() => setRemoving(true)}>
            Remove
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={template !== undefined && !dirty}
          onClick={() => (template ? setDraft(saved) : onDone())}
        >
          Discard
        </Button>
        <Button
          loading={saving.isPending || asking.isPending}
          // A new one may be added as it starts: a Gate needs nothing more.
          disabled={
            (template !== undefined && !dirty) || problems.length > 0 || checkAwaited(check)
          }
          onClick={save}
        >
          {template ? "Save the template" : "Add the template"}
        </Button>
      </div>
      {applyingTo && template && (
        <ApplyTemplateEditDialog
          edit={{ templateId: template.id, before: template.stage, after: draft }}
          linked={applyingTo}
          save={async () => {
            const result = await saveStageTemplate(template.id, draft);
            await refreshStageTemplateList(queryClient);
            setDraft(result.stage);
          }}
          onClose={() => setApplyingTo(undefined)}
        />
      )}
      {removing && template && (
        <RemoveStageTemplateDialog template={template} onClose={() => setRemoving(false)} />
      )}
    </>
  );
}

/**
 * Removing asks first, saying how many Stages are linked to it; it is never refused: they keep
 * their fields and are unlinked.
 */
function RemoveStageTemplateDialog({
  template,
  onClose,
}: {
  readonly template: StageTemplate;
  readonly onClose: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const showToast = useToast();
  const { name } = template.stage;
  const linked = useQuery(stageTemplateQueries.linkedStages(template.id)).data;
  const removing = useMutation({
    mutationFn: () => removeStageTemplate(template.id),
    onSuccess: async () => {
      await refreshStageTemplateList(queryClient);
      showToast(`${name} removed from the Stage templates.`);
      onClose();
      await navigate({ to: "/settings/pipelines" });
    },
  });
  return (
    <Dialog
      size="small"
      title={`Remove ${name}?`}
      onClose={onClose}
      actions={
        <Button variant="danger" loading={removing.isPending} onClick={() => removing.mutate()}>
          Remove the template
        </Button>
      }
    >
      <div className="dialog-stack">
        <p className="dialog-text">{linkedWords(linked)} Tasks that added it keep their copy.</p>
        {removing.error && (
          <RefusalAlert title={`${name} can't be removed`} error={removing.error} />
        )}
      </div>
    </Dialog>
  );
}

function linkedWords(linked: readonly LinkedStage[] | undefined): string {
  if (linked === undefined) return "Its linked Stages keep their fields and are unlinked.";
  if (linked.length === 0) return "No Stage is linked to it.";
  return `Its ${stageCount(linked.length)} linked to it keep their fields and are unlinked.`;
}

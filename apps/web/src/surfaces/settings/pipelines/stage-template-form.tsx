import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Duty, Role, RoleCardOptions, Stage, StageTemplate } from "@the-office/contracts";
import { Button, Card, Dialog, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import {
  addStageTemplate,
  removeStageTemplate,
  saveStageTemplate,
  stageTemplateQueries,
} from "../../../api/pipelines.ts";
import { AskDevopsButton } from "../../../shell/ask-devops.tsx";
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
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";

/** Where a new Stage template starts: the kind the user picked, or the template opened. */
export type StageTemplateOpened =
  | { readonly template: StageTemplate }
  | { readonly template?: undefined; readonly kind: StageKind };

/**
 * The open Stage template in the Stage editor's own form, saved or discarded as a whole; a new one
 * is added the same way. Problems the service would refuse hold Save; a Role nobody fills is only
 * flagged. A template has no "On failure": going back names a Stage only a Pipeline has. A draft
 * with no changes follows the saved template, so one changed elsewhere, such as by a Proposal
 * applied in a chat, shows as saved.
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
      await queryClient.invalidateQueries(stageTemplateQueries.list());
      if (template) {
        setDraft(result.stage);
        showToast("Stage template saved. Pipelines and Tasks that added it keep their copy.");
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
          {STAGE_KIND_NAMES[draft.kind]} template. Adding it to a Pipeline or a Task copies it in:
          editing or removing it later changes no Stage made from it.
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
            template
          />
        </div>
      </Card>
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
          loading={saving.isPending}
          // A new one may be added as it starts: a Gate needs nothing more.
          disabled={
            (template !== undefined && !dirty) || problems.length > 0 || checkAwaited(check)
          }
          onClick={() => saving.mutate()}
        >
          {template ? "Save the template" : "Add the template"}
        </Button>
      </div>
      {removing && template && (
        <RemoveStageTemplateDialog template={template} onClose={() => setRemoving(false)} />
      )}
    </>
  );
}

/** Removing asks first; it is never refused, as Stages added from it are copies. */
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
  const removing = useMutation({
    mutationFn: () => removeStageTemplate(template.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries(stageTemplateQueries.list());
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
        <p className="dialog-text">Pipelines and Tasks that added it keep their copy.</p>
        {removing.error && (
          <RefusalAlert title={`${name} can't be removed`} error={removing.error} />
        )}
      </div>
    </Dialog>
  );
}

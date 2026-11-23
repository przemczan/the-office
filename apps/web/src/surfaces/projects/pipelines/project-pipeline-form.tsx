import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type {
  Duty,
  PipelineEdit,
  Project,
  ProjectPipeline,
  Role,
  RoleCardOptions,
} from "@the-office/contracts";
import { Alert, Badge, Button, Card, Icon, Input, Textarea } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import {
  projectPipelineQueries,
  removeProjectPipeline,
  saveProjectPipeline,
} from "../../../api/pipelines.ts";
import { AskDevopsButton } from "../../../shell/ask-devops.tsx";
import { projectCommandsOf } from "../../../shell/pipelines/library-commands.ts";
import { projectPipelineUseLine } from "../../../shell/pipelines/pipeline-use-words.ts";
import { copiedFromWords } from "../../../shell/pipelines/pipeline-words.ts";
import { RemovePipelineDialog } from "../../../shell/pipelines/remove-pipeline-dialog.tsx";
import { flowProblems } from "../../../shell/pipelines/flow/flow-checks.ts";
import { asFlow } from "../../../shell/pipelines/flow/flow-model.ts";
import { OfficeFlowEditor } from "../../../shell/pipelines/flow/office-flow-editor.tsx";
import { byLevel, checkAwaited } from "../../../shell/pipelines/stages-check.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";

/**
 * The open Project Pipeline (spec §2.3.5, "Project Pipelines"): its head, then its name and
 * description, and its Stages in the same flow editor as an office-wide one, saved or discarded as
 * a whole. The service checks every draft; problems hold Save, warnings don't. One that was Broken
 * before The Office updated is flagged with why and can be saved unchanged, which clears the flag.
 */
export function ProjectPipelineForm({
  project,
  projectPipeline,
  roles,
  duties,
  options,
}: {
  readonly project: Project;
  readonly projectPipeline: ProjectPipeline;
  readonly roles: readonly Role[];
  readonly duties: readonly Duty[];
  readonly options: RoleCardOptions;
}): ReactNode {
  const saved = editOf(projectPipeline);
  const [draft, setDraft] = useState<PipelineEdit>(saved);
  const [removing, setRemoving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const flagged = projectPipeline.brokenBeforeUpdate;
  const check = useQuery({
    ...projectPipelineQueries.check({ ...draft, projectPipelineId: projectPipeline.id }),
    placeholderData: keepPreviousData,
  });
  const { problems, warnings } = byLevel([
    ...(check.data?.problems ?? []),
    ...flowProblems(draft.stages),
  ]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const showToast = useToast();
  const saving = useMutation({
    mutationFn: () => saveProjectPipeline(projectPipeline.id, draft),
    onSuccess: async (result) => {
      // The saved list first, so the bar never reads Unsaved changes against the old one.
      await queryClient.invalidateQueries(projectPipelineQueries.list(project.id));
      // A save may fix it, or end its Broken before the update: the list's flag follows at once.
      void queryClient.invalidateQueries(projectPipelineQueries.needingFixing(project.id));
      setDraft(editOf(result));
      showToast("Pipeline saved. Tasks not started yet follow it; running ones keep their copy.");
    },
  });
  const change = (changed: Partial<PipelineEdit>): void => setDraft({ ...draft, ...changed });
  // Under the form, and under the editor in full screen, so Save stays at hand.
  const saveRow = (withRemove: boolean): ReactNode => (
    <>
      <span className="project-pipeline-actions-state">{dirty ? "Unsaved changes" : "Saved"}</span>
      {withRemove && (
        <Button variant="danger-ghost" onClick={() => setRemoving(true)}>
          Remove
        </Button>
      )}
      <Button variant="secondary" disabled={!dirty} onClick={() => setDraft(saved)}>
        Discard
      </Button>
      <Button
        loading={saving.isPending}
        // One the update left from a Broken one is saved even unchanged, which clears its flag.
        disabled={(!dirty && flagged === null) || problems.length > 0 || checkAwaited(check)}
        onClick={() => saving.mutate()}
      >
        Save the Pipeline
      </Button>
    </>
  );
  return (
    <>
      <ProjectPipelineHead project={project} projectPipeline={projectPipeline} />
      {flagged !== null && (
        <Alert
          tone="warning"
          title={`${projectPipeline.name} was Broken before The Office updated`}
        >
          <ul className="project-pipeline-reasons">
            {flagged.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p>Tasks can choose it once you save it.</p>
        </Alert>
      )}
      <Card>
        <div className="project-pipeline-form">
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
            onChange={(stages) => change({ stages: [...stages] })}
            problems={problems}
            warnings={warnings}
            roles={roles}
            duties={duties}
            options={options}
            commands={projectCommandsOf(project)}
            fullScreenName={`${draft.name || projectPipeline.name} ·`}
            fullScreenBar={saveRow(false)}
          />
        </div>
      </Card>
      {saving.error && <RefusalAlert title="The Pipeline wasn't saved" error={saving.error} />}
      <div className="project-pipeline-actions">{saveRow(true)}</div>
      {removing && (
        <RemovePipelineDialog
          name={projectPipeline.name}
          remove={() => removeProjectPipeline(projectPipeline.id)}
          removedToast={`${projectPipeline.name} removed from ${project.name}'s Pipelines.`}
          onRemoved={async () => {
            await queryClient.invalidateQueries(projectPipelineQueries.list(project.id));
            await navigate({
              to: "/projects/$projectId/pipelines",
              params: { projectId: project.id },
            });
          }}
          onClose={() => setRemoving(false)}
        />
      )}
    </>
  );
}

/**
 * The open Project Pipeline's name with Default, Ask Devops, its description, and "Project
 * Pipeline of the-office · Copied from Full on 12 Nov · Default for the-office · 2 not started
 * Tasks use it", the copy's words alone, as the two Pipelines no longer share anything.
 */
function ProjectPipelineHead({
  project,
  projectPipeline,
}: {
  readonly project: Project;
  readonly projectPipeline: ProjectPipeline;
}): ReactNode {
  const use = useQuery(projectPipelineQueries.use(projectPipeline.id));
  const isDefault = project.defaultPipeline === projectPipeline.id;
  const facts = [
    `Project Pipeline of ${project.name}`,
    copiedFromWords(projectPipeline.copiedFrom),
    ...(isDefault ? [`Default for ${project.name}`] : []),
    ...(use.data ? [projectPipelineUseLine(use.data)] : []),
  ];
  return (
    <Card
      title={
        <span className="project-block-title">
          <Icon name="route" size={15} strokeWidth={1.6} />
          {projectPipeline.name}
          {isDefault && <Badge size="sm">Default</Badge>}
        </span>
      }
      actions={
        <AskDevopsButton
          label={(name) => `Ask ${name}`}
          draft={`Can you propose a change to ${project.name}'s ${projectPipeline.name} Pipeline? `}
        />
      }
    >
      {projectPipeline.description !== "" && (
        <p className="project-block-text">{projectPipeline.description}</p>
      )}
      <p className="project-pipeline-facts">{facts.join(" · ")}</p>
    </Card>
  );
}

/** The Pipeline as the editor holds it: its Stages a flow, each with its place and routes. */
function editOf({ name, description, stages }: ProjectPipeline): PipelineEdit {
  return { name, description, stages: [...asFlow(stages)] };
}

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type {
  OfficeWidePipeline,
  Project,
  ProjectPipeline,
  ProjectPipelineEdit,
  Role,
  RoleCardOptions,
} from "@the-office/contracts";
import { Alert, Badge, Button, Card, Icon, Input, Select, Textarea } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import {
  projectPipelineQueries,
  removeProjectPipeline,
  saveProjectPipeline,
} from "../../../api/pipelines.ts";
import { AskDevopsButton } from "../../../shell/ask-devops.tsx";
import { projectCommandsOf } from "../../../shell/pipelines/library-commands.ts";
import { projectPipelineUseLine } from "../../../shell/pipelines/pipeline-use-words.ts";
import { RemovePipelineDialog } from "../../../shell/pipelines/remove-pipeline-dialog.tsx";
import { counted } from "../../../shell/pipelines/stage-change-words.ts";
import { StageChangesView } from "../../../shell/pipelines/stage-changes-view.tsx";
import { checkAwaited } from "../../../shell/pipelines/stages-check.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";

/**
 * The open Project Pipeline (docs/design/project-pipelines.html, "The editor"): its head, then its
 * name, base Pipeline and description, and what the Project gets in one view, saved or discarded as
 * a whole. The service builds and checks every edit; problems and Broken hold Save (a save never
 * leaves it Broken), flags don't.
 */
export function ProjectPipelineForm({
  project,
  projectPipeline,
  officeWide,
  roles,
  options,
}: {
  readonly project: Project;
  readonly projectPipeline: ProjectPipeline;
  readonly officeWide: readonly OfficeWidePipeline[];
  readonly roles: readonly Role[];
  readonly options: RoleCardOptions;
}): ReactNode {
  const saved = editOf(projectPipeline);
  const [draft, setDraft] = useState<ProjectPipelineEdit>(saved);
  const [removing, setRemoving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const check = useQuery({
    ...projectPipelineQueries.check({
      ...draft,
      projectId: project.id,
      projectPipelineId: projectPipeline.id,
    }),
    placeholderData: keepPreviousData,
  });
  // Until the check answers, the Stages as they were saved.
  const built = check.data ?? projectPipeline;
  const problems = check.data?.problems ?? [];
  const broken = built.broken.length > 0;
  const baseName =
    officeWide.find(({ id }) => id === draft.basePipelineId)?.name ??
    projectPipeline.basePipeline.name;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const showToast = useToast();
  const saving = useMutation({
    mutationFn: () => saveProjectPipeline(projectPipeline.id, draft),
    onSuccess: async (result) => {
      setDraft(editOf(result));
      await queryClient.invalidateQueries(projectPipelineQueries.list(project.id));
      showToast("Pipeline saved. Tasks not started yet follow it; running ones keep their copy.");
    },
  });
  const change = (changed: Partial<ProjectPipelineEdit>): void =>
    setDraft({ ...draft, ...changed });
  return (
    <>
      <ProjectPipelineHead
        project={project}
        projectPipeline={projectPipeline}
        broken={broken}
        baseName={baseName}
        basePipelineId={draft.basePipelineId}
      />
      {broken ? (
        <Alert
          tone="danger"
          title={`${draft.name || projectPipeline.name} is Broken: ${counted(built.broken.length, "Stage change no longer applies", "Stage changes no longer apply")} to ${baseName}`}
        >
          Until {built.broken.length === 1 ? "it is" : "they are"} fixed, Tasks can't choose{" "}
          {projectPipeline.name}. Tasks already started keep their Stages. Fix each one marked in
          red below, then save.
        </Alert>
      ) : (
        projectPipeline.broken.length > 0 &&
        check.data && (
          <Alert
            tone="success"
            title={`Fixed: save it, and Tasks can choose ${projectPipeline.name} again`}
          />
        )
      )}
      <Card>
        <div className="project-pipeline-form">
          <Input
            label="Name"
            value={draft.name}
            onChange={(event) => change({ name: event.target.value })}
          />
          <Select
            label="Base Pipeline"
            hint="An office-wide Pipeline: its edits reach this one, and the Stage changes apply on top."
            value={draft.basePipelineId}
            options={officeWide.map(({ id, name }) => ({ value: id, label: name }))}
            onChange={(basePipelineId) => change({ basePipelineId })}
          />
          <div className="project-pipeline-form-wide">
            <Textarea
              label="Description"
              rows={2}
              value={draft.description}
              onChange={(event) => change({ description: event.target.value })}
            />
          </div>
        </div>
        <StageChangesView
          projectName={project.name}
          baseName={baseName}
          built={built}
          stageChanges={draft.stageChanges}
          onChange={(stageChanges) => change({ stageChanges: [...stageChanges] })}
          problems={problems}
          flags={check.data?.flags ?? []}
          pending={checkAwaited(check)}
          roles={roles}
          options={options}
          commands={projectCommandsOf(project)}
        />
      </Card>
      {saving.error && <RefusalAlert title="The Pipeline wasn't saved" error={saving.error} />}
      <div className="project-pipeline-actions">
        <span className="project-pipeline-actions-state">
          {dirty ? "Unsaved changes" : "Saved"}
        </span>
        <Button variant="danger-ghost" onClick={() => setRemoving(true)}>
          Remove
        </Button>
        <Button variant="secondary" disabled={!dirty} onClick={() => setDraft(saved)}>
          Discard
        </Button>
        <Button
          loading={saving.isPending}
          disabled={!dirty || broken || problems.length > 0 || checkAwaited(check)}
          title={
            broken
              ? "Fix the Stage changes that don't apply first: a save never leaves it Broken"
              : undefined
          }
          onClick={() => saving.mutate()}
        >
          Save the Pipeline
        </Button>
      </div>
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
 * The open Project Pipeline's name with Default and Broken, Ask Devops, its description, and
 * "Project Pipeline of the-office · Built from Full · Default for the-office · 2 not started Tasks
 * use it", Built from linking to its base Pipeline in Settings › Pipelines.
 */
function ProjectPipelineHead({
  project,
  projectPipeline,
  broken,
  baseName,
  basePipelineId,
}: {
  readonly project: Project;
  readonly projectPipeline: ProjectPipeline;
  readonly broken: boolean;
  readonly baseName: string;
  readonly basePipelineId: string;
}): ReactNode {
  const use = useQuery(projectPipelineQueries.use(projectPipeline.id));
  const isDefault = project.defaultPipeline === projectPipeline.id;
  return (
    <Card
      title={
        <span className="project-block-title">
          <Icon name="route" size={15} strokeWidth={1.6} />
          {projectPipeline.name}
          {isDefault && <Badge size="sm">Default</Badge>}
          {broken && (
            <Badge size="sm" tone="danger">
              Broken
            </Badge>
          )}
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
      <p className="project-pipeline-facts">
        <span>Project Pipeline of {project.name}</span>
        <span aria-hidden="true">·</span>
        <span>
          Built from{" "}
          <Link
            to="/settings/pipelines/$pipelineId"
            params={{ pipelineId: basePipelineId }}
            title={`Open ${baseName} in Settings › Pipelines`}
          >
            {baseName}
          </Link>
        </span>
        {isDefault && (
          <>
            <span aria-hidden="true">·</span>
            <span>Default for {project.name}</span>
          </>
        )}
        {use.data && (
          <>
            <span aria-hidden="true">·</span>
            <span>{projectPipelineUseLine(use.data)}</span>
          </>
        )}
      </p>
    </Card>
  );
}

function editOf({
  name,
  description,
  basePipeline,
  stageChanges,
}: ProjectPipeline): ProjectPipelineEdit {
  return { name, description, basePipelineId: basePipeline.id, stageChanges };
}

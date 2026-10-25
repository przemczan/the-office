import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  projectMarkColourSchema,
  publishingModeSchema,
  type NewProject,
  type ProjectCommandKey,
  type ProjectMarkColour,
} from "@the-office/contracts";
import { Button, Dialog, Field, Input, RadioGroup, SegmentedControl, Select } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { pipelineQueries } from "../../api/pipelines.ts";
import { addProject, projectQueries } from "../../api/projects.ts";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import {
  COMMAND_KEYS,
  COMMAND_LABELS,
  INSTALL_INPUTS_LABEL,
  installInputsFrom,
  MARK_COLOUR_LABELS,
  markLabelFor,
  publishingLabel,
  stagesLine,
} from "./project-labels.ts";

const COMMAND_EXAMPLES: Readonly<Record<ProjectCommandKey, string>> = {
  install: "npm ci",
  build: "npm run build",
  lint: "npm run lint",
  test: "npm test",
};

const EMPTY: NewProject = {
  name: "",
  path: "",
  baseBranch: "main",
  mark: { label: "", colour: "teal" },
  commands: { install: "", build: "", lint: "", test: "" },
  installInputs: [],
  publishingMode: "push-and-pull-request",
  defaultPipeline: "full",
};

/** "Add a Project" as a form: the service checks the path and branch before anything is saved. */
export function AddProjectDialog({ onClose }: { readonly onClose: () => void }): ReactNode {
  const formId = useId();
  const [draft, setDraft] = useState(EMPTY);
  // The label follows the name until the user writes one of their own.
  const [labelEdited, setLabelEdited] = useState(false);
  // Kept as typed, so a comma just written isn't dropped before the next path.
  const [installInputs, setInstallInputs] = useState("");
  const pipelines = useQuery(pipelineQueries.list());
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const showToast = useToast();
  const adding = useMutation({
    mutationFn: addProject,
    onSuccess: async (project) => {
      queryClient.setQueryData(projectQueries.one(project.id).queryKey, project);
      await queryClient.invalidateQueries(projectQueries.list());
      showToast(`${project.name} added.`);
      onClose();
      await navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
    },
  });
  const change = (fields: Partial<NewProject>): void => setDraft({ ...draft, ...fields });
  const mark = { ...draft.mark, label: labelEdited ? draft.mark.label : markLabelFor(draft.name) };
  const defaultPipeline = pipelines.data?.find((pipeline) => pipeline.id === draft.defaultPipeline);
  return (
    <Dialog
      title="Add a Project"
      description="A git repository on this workstation. The Office checks the folder and the branch before saving."
      width={620}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={adding.isPending}>
            Add the Project
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="add-project-form"
        onSubmit={(event) => {
          event.preventDefault();
          adding.mutate({ ...draft, mark, installInputs: installInputsFrom(installInputs) });
        }}
      >
        {adding.error && (
          <RefusalAlert title="The Project can't be added yet" error={adding.error} />
        )}
        <div className="add-project-columns">
          <Input
            label="Name"
            value={draft.name}
            onChange={(event) => change({ name: event.target.value })}
            autoFocus
          />
          <Field label="Mark">
            <div className="add-project-mark">
              <ProjectMark project={{ name: draft.name, mark }} size="xl" />
              <Input
                aria-label="Mark label"
                value={mark.label}
                maxLength={3}
                onChange={(event) => {
                  setLabelEdited(true);
                  change({ mark: { ...mark, label: event.target.value } });
                }}
                style={{ width: "var(--mark-label-width)" }}
              />
              <SegmentedControl
                size="sm"
                value={mark.colour}
                options={projectMarkColourSchema.options.map((colour) => ({
                  value: colour,
                  label: MARK_COLOUR_LABELS[colour],
                }))}
                onChange={(colour) => change({ mark: { ...mark, colour: colourOf(colour) } })}
              />
            </div>
          </Field>
        </div>
        <Input
          label="Repository folder"
          hint="The repository's top-level folder, as a full path."
          value={draft.path}
          onChange={(event) => change({ path: event.target.value })}
          inputStyle={{ fontFamily: "var(--font-mono)" }}
        />
        <div className="add-project-columns">
          <Input
            label="Base branch"
            hint="Tasks branch from it and publish to it."
            value={draft.baseBranch}
            onChange={(event) => change({ baseBranch: event.target.value })}
            inputStyle={{ fontFamily: "var(--font-mono)" }}
          />
          <Select
            label="Default Pipeline"
            hint={defaultPipeline && stagesLine(defaultPipeline)}
            value={draft.defaultPipeline}
            options={(pipelines.data ?? []).map((pipeline) => ({
              value: pipeline.id,
              label: pipeline.name,
            }))}
            onChange={(pipelineId) => change({ defaultPipeline: pipelineId })}
          />
        </div>
        <div className="add-project-columns">
          {COMMAND_KEYS.map((key) => (
            <Input
              key={key}
              label={COMMAND_LABELS[key]}
              placeholder={COMMAND_EXAMPLES[key]}
              value={draft.commands[key]}
              onChange={(event) =>
                change({ commands: { ...draft.commands, [key]: event.target.value } })
              }
              inputStyle={{ fontFamily: "var(--font-mono)" }}
            />
          ))}
        </div>
        <Input
          label={INSTALL_INPUTS_LABEL}
          hint="Files whose change makes a worktree install again, separated by commas. With none, a worktree installs once."
          placeholder="package-lock.json"
          value={installInputs}
          onChange={(event) => setInstallInputs(event.target.value)}
          inputStyle={{ fontFamily: "var(--font-mono)" }}
        />
        <Field label="Publishing">
          <RadioGroup
            value={draft.publishingMode}
            options={publishingModeSchema.options.map((mode) => ({
              value: mode,
              label: publishingLabel(mode, draft.baseBranch.trim() || "the base branch"),
            }))}
            onChange={(mode) => change({ publishingMode: publishingModeSchema.parse(mode) })}
          />
        </Field>
      </form>
    </Dialog>
  );
}

function colourOf(value: string): ProjectMarkColour {
  return projectMarkColourSchema.parse(value);
}

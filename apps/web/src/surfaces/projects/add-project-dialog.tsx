import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  markLabelFor,
  publishingModeSchema,
  type NewProject,
  type ProjectCommandKey,
} from "@the-office/contracts";
import { Button, Dialog, Field, Input, RadioGroup, SegmentedControl, Select } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { pipelineQueries } from "../../api/pipelines.ts";
import { addProject, projectQueries } from "../../api/projects.ts";
import { stagesLine } from "../../shell/pipelines/pipeline-words.ts";
import {
  COMMAND_KEYS,
  COMMAND_LABELS,
  INSTALL_INPUTS_LABEL,
  publishingLabel,
} from "../../shell/project-words.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { GitHubRepositoryPicker } from "./github-repository-picker.tsx";
import { MarkPicker } from "./mark-picker.tsx";
import { installInputsFrom } from "./project-labels.ts";
import {
  RepositoryCloneStep,
  repositoryNameOf,
  useRepositoryCloning,
  type ClonedRepository,
} from "./repository-clone-step.tsx";

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

type WhereItIs = "folder" | "git-url" | "github";

const WHERE_IT_IS_OPTIONS: { value: WhereItIs; label: string }[] = [
  { value: "folder", label: "A folder" },
  { value: "git-url", label: "A git URL" },
  { value: "github", label: "From GitHub" },
];

/**
 * "Add a Project" as a form: the service checks the path and branch before anything is saved. A
 * repository given by its git URL, or picked from GitHub, is cloned first, then added by its
 * clone's path.
 */
export function AddProjectDialog({ onClose }: { readonly onClose: () => void }): ReactNode {
  const formId = useId();
  const cloneFormId = useId();
  const [whereItIs, setWhereItIs] = useState<WhereItIs>("folder");
  const cloning = useRepositoryCloning();
  const cloned = cloning.clone?.state === "cloned" ? cloning.clone : undefined;
  const [draft, setDraft] = useState(EMPTY);
  // The form is filled from a clone once, as it finishes; the user's edits are kept after.
  const [filledFrom, setFilledFrom] = useState<string>();
  if (cloned && filledFrom !== cloned.id) {
    setFilledFrom(cloned.id);
    setDraft(draftFromClone(draft, cloned));
  }
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
  // A repository by its git URL or from GitHub is cloned before the form opens.
  const step = cloned || whereItIs === "folder" ? "form" : whereItIs;
  const forgetClone = (): void => {
    // A name the clone filled in goes with it, so the next one fills its own; a written one stays.
    const filledName = cloned && repositoryNameOf(cloned.url);
    cloning.forget();
    setFilledFrom(undefined);
    change({ path: "", repositoryUrl: undefined, ...(draft.name === filledName && { name: "" }) });
  };
  // First in each step, inside the step's own form or list so it takes the step's spacing.
  const whereItIsBlock = (
    <>
      <p className="dialog-text">
        A git repository on this workstation, or one cloned by its git URL or from GitHub. The
        Office checks the folder and the branch before saving.
      </p>
      <Field label="Where it is">
        {/* A block of its own, so the control keeps its width rather than the form's. */}
        <div>
          <SegmentedControl
            size="sm"
            value={whereItIs}
            options={WHERE_IT_IS_OPTIONS}
            onChange={(value) => {
              setWhereItIs(whereItIsOf(value));
              forgetClone();
            }}
          />
        </div>
      </Field>
    </>
  );
  return (
    <Dialog
      size="medium"
      title="Add a Project"
      onClose={onClose}
      actions={
        <>
          {step === "git-url" && (
            <Button type="submit" form={cloneFormId} loading={cloning.busy}>
              Clone
            </Button>
          )}
          {/* Picking a repository from GitHub starts its clone, so that step submits nothing. */}
          {step === "form" && (
            <Button type="submit" form={formId} loading={adding.isPending}>
              Add the Project
            </Button>
          )}
        </>
      }
    >
      {step === "github" && (
        <GitHubRepositoryPicker cloning={cloning}>{whereItIsBlock}</GitHubRepositoryPicker>
      )}
      {step === "git-url" && (
        <RepositoryCloneStep formId={cloneFormId} cloning={cloning}>
          {whereItIsBlock}
        </RepositoryCloneStep>
      )}
      {step === "form" && (
        <form
          id={formId}
          className="add-project-form"
          onSubmit={(event) => {
            event.preventDefault();
            adding.mutate({ ...draft, mark, installInputs: installInputsFrom(installInputs) });
          }}
        >
          {whereItIsBlock}
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
            <MarkPicker
              project={{ name: draft.name }}
              mark={mark}
              onChange={(changed) => {
                if (changed.label !== mark.label) setLabelEdited(true);
                change({ mark: changed });
              }}
            />
          </div>
          {cloned ? (
            <div className="add-project-cloned">
              <Input
                label="Repository URL"
                hint={`Cloned into ${cloned.path}`}
                value={cloned.url}
                readOnly
                inputStyle={{ fontFamily: "var(--font-mono)" }}
              />
              <Button variant="secondary" size="sm" onClick={forgetClone}>
                {whereItIs === "github" ? "Pick another repository" : "Use another URL"}
              </Button>
            </div>
          ) : (
            <Input
              label="Repository folder"
              hint="The repository's top-level folder, as a full path."
              value={draft.path}
              onChange={(event) => change({ path: event.target.value })}
              inputStyle={{ fontFamily: "var(--font-mono)" }}
            />
          )}
          <div className="add-project-columns">
            {cloned ? (
              <Select
                label="Base branch"
                hint="Tasks branch from it and publish to it."
                value={draft.baseBranch}
                options={cloned.branches.map((branch) => ({ value: branch, label: branch }))}
                onChange={(branch) => change({ baseBranch: branch })}
              />
            ) : (
              <Input
                label="Base branch"
                hint="Tasks branch from it and publish to it."
                value={draft.baseBranch}
                onChange={(event) => change({ baseBranch: event.target.value })}
                inputStyle={{ fontFamily: "var(--font-mono)" }}
              />
            )}
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
      )}
    </Dialog>
  );
}

/** The clone's path and Repository URL, its default branch, and its name unless one is written. */
function draftFromClone(draft: NewProject, clone: ClonedRepository): NewProject {
  return {
    ...draft,
    name: draft.name.trim() === "" ? repositoryNameOf(clone.url) : draft.name,
    path: clone.path,
    repositoryUrl: clone.url,
    baseBranch: clone.defaultBranch,
  };
}

function whereItIsOf(value: string): WhereItIs {
  return WHERE_IT_IS_OPTIONS.find((option) => option.value === value)?.value ?? "folder";
}

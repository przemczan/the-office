import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  markLabelFor,
  type GitHubRepository,
  type NewProject,
  type RepositoryClone,
  type RunEnvironmentAnswer,
} from "@the-office/contracts";
import { Button, Dialog, Field, Input, SegmentedControl } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { addProject, projectQueries } from "../../api/projects.ts";
import { STARTING_COMMANDS } from "../../shell/project-words.ts";
import { useToast } from "../../shell/toasts.tsx";
import {
  WHERE_IT_IS_OPTIONS,
  draftFromSource,
  sourceKeyOf,
  sourceNameOf,
  whereItIsOf,
  type ProjectSource,
  type WhereItIs,
} from "./add-project-source.ts";
import { GitHubRepositoryPicker, useGitHubRepositoriesEarly } from "./github-repository-picker.tsx";
import { ProjectDetailsStep } from "./project-details-step.tsx";
import { installInputsFrom } from "./project-labels.ts";
import { RepositoryCloneStep, useRepositoryCloning } from "./repository-clone-step.tsx";

const EMPTY: NewProject = {
  name: "",
  path: "",
  baseBranch: "main",
  mark: { label: "", colour: "teal" },
  installCommand: "",
  commands: STARTING_COMMANDS.map((command) => ({
    ...command,
    commandLine: "",
    rerunCommandLine: "",
  })),
  installInputs: [],
  publishingMode: "push-and-pull-request",
  defaultPipeline: "full",
};

/**
 * "Add a Project" in two steps, in a window that keeps one height: step 1 is where the repository
 * is (a folder, or one cloned by its git URL or from GitHub), step 2 the Project's fields. The
 * service checks the path and branch before anything is saved.
 */
export function AddProjectDialog({ onClose }: { readonly onClose: () => void }): ReactNode {
  const stepFormId = useId();
  const [whereItIs, setWhereItIs] = useState<WhereItIs>("folder");
  // Step 1's own fields stay as written, so Change finds them again.
  const [folder, setFolder] = useState("");
  const [folderChosen, setFolderChosen] = useState(false);
  const [folderMissing, setFolderMissing] = useState(false);
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<GitHubRepository>();
  const cloning = useRepositoryCloning();
  useGitHubRepositoriesEarly();
  const source = sourceOf(
    whereItIs,
    folderChosen ? folder.trim() : undefined,
    cloning.clone,
    picked,
  );
  const [draft, setDraft] = useState(EMPTY);
  // The form is filled from each source once, as it is chosen; the user's edits are kept after.
  const [filledFrom, setFilledFrom] = useState<string>();
  // The name the source wrote, which goes with it on Change; a name the user wrote stays.
  const [filledName, setFilledName] = useState<string>();
  if (source && filledFrom !== sourceKeyOf(source)) {
    const name = draft.name.trim() === "" ? sourceNameOf(source) : undefined;
    setFilledFrom(sourceKeyOf(source));
    setFilledName(name);
    setDraft(draftFromSource({ ...draft, ...(name !== undefined && { name }) }, source));
  }
  // The label follows the name until the user writes one of their own.
  const [labelEdited, setLabelEdited] = useState(false);
  // Kept as typed, so a comma just written isn't dropped before the next path.
  const [installInputs, setInstallInputs] = useState("");
  const [runEnvironmentAnswer, setRunEnvironmentAnswer] =
    useState<RunEnvironmentAnswer>("decide-later");
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
  const backToStepOne = (): void => {
    cloning.forget();
    setPicked(undefined);
    setFolderChosen(false);
    setFilledFrom(undefined);
    setFilledName(undefined);
    adding.reset();
    // What the source filled in goes with it: a clone's branch, as the next source may lack it.
    setDraft({
      ...draft,
      path: EMPTY.path,
      repositoryUrl: undefined,
      ...(source?.whereItIs !== "folder" && { baseBranch: EMPTY.baseBranch }),
      ...(filledName !== undefined && draft.name === filledName && { name: EMPTY.name }),
    });
  };
  const chooseWhereItIs = (value: WhereItIs): void => {
    backToStepOne();
    setFolderMissing(false);
    setWhereItIs(value);
  };
  const stepHint = <span className="dialog-hint">{source ? "Step 2 of 2" : "Step 1 of 2"}</span>;
  return (
    <Dialog
      size="medium"
      keepsHeight
      title="Add a Project"
      // The GitHub list's search only finds a repository; a picked one is the user's choice.
      unsavedChanges={
        source !== undefined || picked !== undefined || folder.trim() !== "" || url.trim() !== ""
      }
      onClose={onClose}
      actions={
        <>
          {source ? (
            <Button type="submit" form={stepFormId} loading={adding.isPending}>
              Add the Project
            </Button>
          ) : whereItIs === "folder" ? (
            <Button type="submit" form={stepFormId}>
              Continue
            </Button>
          ) : whereItIs === "git-url" ? (
            <Button type="submit" form={stepFormId} loading={cloning.busy}>
              Clone
            </Button>
          ) : (
            // Clones the repository picked from GitHub; again after a failure, it tries again.
            <Button
              disabled={picked === undefined}
              loading={cloning.busy}
              onClick={() => {
                if (picked) cloning.start(picked.repositoryUrl);
              }}
            >
              Clone
            </Button>
          )}
          {stepHint}
        </>
      }
    >
      <div className={`add-project${!source && whereItIs === "github" ? " fills" : ""}`}>
        {source ? (
          <ProjectDetailsStep
            formId={stepFormId}
            source={source}
            draft={draft}
            mark={mark}
            installInputs={installInputs}
            runEnvironmentAnswer={runEnvironmentAnswer}
            refusal={adding.error}
            onChange={change}
            onMarkChange={(changed) => {
              if (changed.label !== mark.label) setLabelEdited(true);
              change({ mark: changed });
            }}
            onInstallInputsChange={setInstallInputs}
            onRunEnvironmentAnswerChange={setRunEnvironmentAnswer}
            onChangeSource={backToStepOne}
            onSubmit={() =>
              adding.mutate({
                ...draft,
                mark,
                installInputs: installInputsFrom(installInputs),
                runEnvironmentAnswer,
              })
            }
          />
        ) : (
          <>
            <Field
              label="Where it is"
              hint={WHERE_IT_IS_OPTIONS.find((option) => option.value === whereItIs)?.hint}
            >
              {/* A block of its own, so the control keeps its width rather than the field's. */}
              <div>
                <SegmentedControl
                  size="sm"
                  value={whereItIs}
                  options={WHERE_IT_IS_OPTIONS.map(({ value, label }) => ({ value, label }))}
                  onChange={(value) => chooseWhereItIs(whereItIsOf(value))}
                />
              </div>
            </Field>
            {whereItIs === "folder" && (
              <form
                id={stepFormId}
                className="add-project-stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  const missing = folder.trim() === "";
                  setFolderMissing(missing);
                  setFolderChosen(!missing);
                }}
              >
                <Input
                  label="Repository folder"
                  hint="The repository's top-level folder, as a full path."
                  error={
                    folderMissing ? "Write the repository's folder, as a full path." : undefined
                  }
                  placeholder="/home/you/Projects/repository"
                  value={folder}
                  onChange={(event) => setFolder(event.target.value)}
                  inputStyle={{ fontFamily: "var(--font-mono)" }}
                  spellCheck={false}
                  autoFocus
                />
              </form>
            )}
            {whereItIs === "git-url" && (
              <RepositoryCloneStep
                formId={stepFormId}
                cloning={cloning}
                url={url}
                onUrlChange={setUrl}
              />
            )}
            {whereItIs === "github" && (
              <GitHubRepositoryPicker
                cloning={cloning}
                picked={picked}
                onPick={setPicked}
                onUseGitUrl={() => chooseWhereItIs("git-url")}
              />
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

/** What step 1 chose, once it has: the folder, or the finished clone. */
function sourceOf(
  whereItIs: WhereItIs,
  folder: string | undefined,
  clone: RepositoryClone | undefined,
  picked: GitHubRepository | undefined,
): ProjectSource | undefined {
  if (whereItIs === "folder") return folder === undefined ? undefined : { whereItIs, path: folder };
  if (clone?.state !== "cloned") return undefined;
  return whereItIs === "github" ? { whereItIs, clone, repository: picked } : { whereItIs, clone };
}

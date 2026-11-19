import {
  initiativeBranchOf,
  SHORT_NAME_MAX_LENGTH,
  type Initiative,
  type Project,
} from "@the-office/contracts";
import { Alert, Button, Icon, Input, Switch } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { setInitiativePipelines } from "../../api/work.ts";
import type { PipelineChoiceGroup } from "../../shell/pipelines/pipeline-choices.ts";
import { PipelinePicker } from "../../shell/pipelines/pipeline-picker.tsx";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import {
  hasGate,
  pipelineShapeWords,
  shortNameFormProblem,
  shortNameFromTitle,
  type PipelineShown,
} from "./initiative-pipeline-words.ts";
import { useInitiativeChange } from "./use-initiative-change.ts";

/** One Project the Initiative spans, as the editor offers it. */
export interface EditedProject {
  readonly projectId: string;
  readonly project: Project | undefined;
  readonly projectName: string;
  /** Its Pipeline now; null for None, no Initiative's branch. */
  readonly pipelineId: string | null;
  /** Its Pipelines to choose from; undefined until they are read. */
  readonly groups: readonly PipelineChoiceGroup[] | undefined;
}

/** The block as the user edits it: unsaved until Save. */
interface Draft {
  readonly onBranch: Readonly<Record<string, boolean>>;
  /** Each Project's Pipeline, "" for none chosen; kept while its switch is off. */
  readonly pipelines: Readonly<Record<string, string>>;
  readonly shortName: string;
}

/** What Save found wrong, by field: "shortName", or a Project's id for its Pipeline. */
type Problems = Readonly<Record<string, string>>;

/**
 * The Pipelines block after Edit (docs/design/initiative-pipelines-block.html): three steps in the
 * order they are decided, whether each Project works on an Initiative's branch, the branch's name,
 * then each switched-on Project's Pipeline, required. Save writes it all at once; Cancel throws the
 * draft away.
 */
export function InitiativePipelinesEditor({
  initiative,
  projects,
  pipelineOf,
  onClose,
}: {
  readonly initiative: Initiative;
  readonly projects: readonly EditedProject[];
  readonly pipelineOf: (pipelineId: string) => PipelineShown | undefined;
  readonly onClose: () => void;
}): ReactNode {
  const [draft, setDraft] = useState(() => draftOf(initiative, projects));
  const [problems, setProblems] = useState<Problems>({});
  const saving = useInitiativeChange(initiative, (saved: Draft) =>
    setInitiativePipelines(initiative.id, {
      pipelines: projects.map(({ projectId }) => ({
        projectId,
        pipelineId:
          saved.onBranch[projectId] === true ? (saved.pipelines[projectId] ?? null) : null,
      })),
      shortName: anyOnBranch(saved) ? saved.shortName : null,
    }),
  );
  const anyOn = anyOnBranch(draft);
  const branch = initiativeBranchOf(draft.shortName === "" ? "…" : draft.shortName);

  const switchProject = ({ projectId, groups }: EditedProject, on: boolean): void => {
    setDraft((current) => ({
      onBranch: { ...current.onBranch, [projectId]: on },
      pipelines:
        on && (current.pipelines[projectId] ?? "") === ""
          ? { ...current.pipelines, [projectId]: defaultPipelineOf(groups) }
          : current.pipelines,
      shortName:
        on && current.shortName === "" ? shortNameFromTitle(initiative.name) : current.shortName,
    }));
    setProblems(({ [projectId]: _dropped, ...others }) => others);
  };

  const save = (): void => {
    const found = problemsOf(draft, projects);
    setProblems(found);
    if (Object.keys(found).length === 0) saving.mutate(draft, { onSuccess: onClose });
  };

  return (
    <form
      className="initiative-pipelines-editor"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <EditorStep number={1} title="Work on an Initiative's branch?" on>
        <p className="initiative-pipelines-step-hint">
          On, the Initiative's Tasks start from its own branch and publish into it, and one
          Publishing Task puts the whole change into the base branch at the end. Off, each Task
          publishes on its own, as it is done. Fixed at Confirm.
        </p>
        <ul className="initiative-pipelines-switches" aria-label="Initiative's branch, per Project">
          {projects.map((edited) => {
            const on = draft.onBranch[edited.projectId] === true;
            const baseBranch = edited.project?.baseBranch ?? "its base branch";
            return (
              <li key={edited.projectId} className="initiative-pipelines-switch">
                <Switch
                  checked={on}
                  onChange={(checked) => switchProject(edited, checked)}
                  label={
                    <span className="initiative-pipelines-project-name">
                      {edited.project && <ProjectMark project={edited.project} />}
                      {edited.projectName}
                    </span>
                  }
                  description={
                    on ? (
                      <>
                        Works on <code>{branch}</code>, published into {baseBranch} by its
                        Publishing Task.
                      </>
                    ) : (
                      `Task by Task: each Task publishes into ${baseBranch} as it is done.`
                    )
                  }
                />
              </li>
            );
          })}
        </ul>
      </EditorStep>

      <EditorStep number={2} title="Branch name" on={anyOn}>
        {anyOn ? (
          <div className="initiative-pipelines-short-name">
            <Input
              aria-label="Short name"
              value={draft.shortName}
              maxLength={SHORT_NAME_MAX_LENGTH}
              spellCheck={false}
              autoComplete="off"
              required
              aria-invalid={problems.shortName !== undefined}
              error={problems.shortName}
              hint={`The Initiative's Short name, one for all its Projects: lower-case a–z, 0–9 and -, at most ${SHORT_NAME_MAX_LENGTH} characters.`}
              iconLeft={
                <span className="initiative-pipelines-branch-prefix">
                  <Icon name="git-branch" size={13} />
                  initiative/
                </span>
              }
              inputStyle={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}
              onChange={(event) => {
                const shortName = event.target.value;
                setDraft((current) => ({ ...current, shortName }));
                setProblems(({ shortName: _dropped, ...others }) => others);
              }}
            />
          </div>
        ) : (
          <p className="initiative-pipelines-off-note">
            Only with an Initiative's branch: switch a Project on above.
          </p>
        )}
      </EditorStep>

      <EditorStep number={3} title="Pipeline" on={anyOn}>
        {anyOn ? (
          <>
            <p className="initiative-pipelines-step-hint">
              What the Publishing Task walks before the branch is published.
            </p>
            <ul className="initiative-pipelines-rows">
              {projects
                .filter(({ projectId }) => draft.onBranch[projectId] === true)
                .map((edited) => (
                  <PipelineRow
                    key={edited.projectId}
                    edited={edited}
                    pipelineId={draft.pipelines[edited.projectId] ?? ""}
                    problem={problems[edited.projectId]}
                    pipelineOf={pipelineOf}
                    onChange={(pipelineId) => {
                      setDraft((current) => ({
                        ...current,
                        pipelines: { ...current.pipelines, [edited.projectId]: pipelineId },
                      }));
                      setProblems(({ [edited.projectId]: _dropped, ...others }) => others);
                    }}
                  />
                ))}
            </ul>
          </>
        ) : (
          <p className="initiative-pipelines-off-note">
            Only with an Initiative's branch: a Project publishing Task by Task needs none.
          </p>
        )}
      </EditorStep>

      {saving.error && <RefusalAlert title="The Pipelines weren't saved" error={saving.error} />}
      <div className="initiative-pipelines-editor-actions">
        <Button
          size="sm"
          type="submit"
          loading={saving.isPending}
          iconLeft={<Icon name="check" size={14} />}
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** One numbered step; dimmed while it doesn't apply. */
function EditorStep({
  number,
  title,
  on,
  children,
}: {
  readonly number: number;
  readonly title: string;
  readonly on: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section className="initiative-pipelines-step" data-off={!on} aria-label={title}>
      <span className="initiative-pipelines-step-number" aria-hidden="true">
        {number}
      </span>
      <div className="initiative-pipelines-step-body">
        <h3 className="initiative-pipelines-step-title">
          {title}
          {on && number > 1 && (
            <span className="initiative-pipelines-required" aria-hidden="true">
              *
            </span>
          )}
        </h3>
        {children}
      </div>
    </section>
  );
}

/** A switched-on Project's Pipeline: its picker, its shape, and a warning when it has no Gate. */
function PipelineRow({
  edited: { project, projectName, groups },
  pipelineId,
  problem,
  pipelineOf,
  onChange,
}: {
  readonly edited: EditedProject;
  readonly pipelineId: string;
  readonly problem: string | undefined;
  readonly pipelineOf: (pipelineId: string) => PipelineShown | undefined;
  readonly onChange: (pipelineId: string) => void;
}): ReactNode {
  const pipeline = pipelineId === "" ? undefined : pipelineOf(pipelineId);
  const noGate = pipeline !== undefined && !hasGate(pipeline.stages) ? pipeline : undefined;
  return (
    <li className="initiative-pipelines-row" aria-label={projectName}>
      <span className="initiative-pipelines-project-name">
        {project && <ProjectMark project={project} />}
        {projectName}
      </span>
      <span className="initiative-pipelines-row-choice">
        <PipelinePicker
          label={`${projectName}'s Pipeline`}
          labelHidden
          size="sm"
          placeholder="Choose a Pipeline"
          value={pipelineId}
          groups={groups ?? []}
          disabled={groups === undefined}
          onChange={onChange}
        />
        {pipeline && (
          <span className="initiative-pipelines-shape">{pipelineShapeWords(pipeline.stages)}</span>
        )}
      </span>
      {(problem !== undefined || noGate !== undefined) && (
        <div className="initiative-pipelines-row-extra">
          {problem !== undefined && (
            <span className="initiative-pipelines-error" role="alert">
              <Icon name="circle-alert" size={13} />
              {problem}
            </span>
          )}
          {noGate !== undefined && (
            <Alert tone="warning" title="Publishes without your review">
              No Stage of {noGate.name} is a Gate, so the Initiative's branch in {projectName} is
              published into {project?.baseBranch ?? "its base branch"} without you looking at it
              first.
            </Alert>
          )}
        </div>
      )}
    </li>
  );
}

function draftOf(initiative: Initiative, projects: readonly EditedProject[]): Draft {
  return {
    onBranch: Object.fromEntries(
      projects.map(({ projectId, pipelineId }) => [projectId, pipelineId !== null]),
    ),
    pipelines: Object.fromEntries(
      projects.map(({ projectId, pipelineId }) => [projectId, pipelineId ?? ""]),
    ),
    shortName: initiative.shortName ?? "",
  };
}

function anyOnBranch(draft: Draft): boolean {
  return Object.values(draft.onBranch).some(Boolean);
}

/** The Project default Pipeline among its choices, or "" when it has none. */
function defaultPipelineOf(groups: readonly PipelineChoiceGroup[] | undefined): string {
  const choices = groups?.flatMap(({ choices: grouped }) => grouped) ?? [];
  return choices.find(({ isDefault, brokenWhy }) => isDefault && brokenWhy === undefined)?.id ?? "";
}

/** Every problem Save checks before it sends; none with every Project switched off. */
function problemsOf(draft: Draft, projects: readonly EditedProject[]): Problems {
  if (!anyOnBranch(draft)) return {};
  const found: Record<string, string> = {};
  const shortNameProblem = shortNameFormProblem(draft.shortName);
  if (shortNameProblem !== undefined) found.shortName = shortNameProblem;
  for (const { projectId } of projects) {
    if (draft.onBranch[projectId] === true && (draft.pipelines[projectId] ?? "") === "") {
      found[projectId] =
        "Choose a Pipeline: a Project on an Initiative's branch publishes through one.";
    }
  }
  return found;
}

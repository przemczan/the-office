import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ACTION_KINDS,
  ACTION_NAME_MAX_LENGTH,
  ACTION_RESERVED_VARIABLES,
  ACTION_TIME_LIMIT_MINUTES,
  type Action,
  type ActionField,
  type ActionKind,
  type EditedAction,
  type ManualWorkflow,
  type Project,
  type TestTargetSetter,
} from "@the-office/contracts";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  Input,
  RadioList,
  Select,
  Stepper,
} from "@the-office/ui";
import { Fragment, useState, type ReactNode } from "react";
import { useSaveActions } from "../../../api/actions.ts";
import { ciRunQueries } from "../../../api/ci-runs.ts";
import { projectQueries } from "../../../api/projects.ts";
import { ACTION_KIND_LABELS, minutesWords } from "../../../shell/action-words.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { TEST_TARGET_KIND_LABELS } from "../../../shell/test-target-words.ts";
import { useToast } from "../../../shell/toasts.tsx";
import { WorkflowInputControl, workflowInputValuesOf } from "../../../shell/workflow-inputs.tsx";
import { CommandsBeforeField, Marked } from "../commands-before-field.tsx";
import {
  actionDraftOf,
  actionsWith,
  editedActionOf,
  NEW_ACTION_DRAFT,
  undeclaredInputWords,
  withKind,
  type ActionDraft,
} from "./action-words.ts";

/**
 * How far the time limit's stepper moves at a press, in minutes: 5, and 1 up to 10 minutes so it
 * reaches every limit from 1.
 */
function timeLimitStep(minutes: number): number {
  return minutes > 10 ? 5 : 1;
}

/** Each kind's line under its radio, naming the Project. */
function kindLine(kind: ActionKind, projectName: string): string {
  switch (kind) {
    case "project-command":
      return `Runs one of ${projectName}'s commands in a fresh checkout of what you pick.`;
    case "test-target":
      return `Launches one of ${projectName}'s test targets on what you pick.`;
    case "workflow":
      return "Starts one of the repository's workflows on the code host, on the branch you pick.";
  }
}

/**
 * The Action editor (spec: project-page.md, "The Action editor"): a large window adding an Action
 * or changing one, saved with the Project's whole list; its key is fixed once added.
 */
export function ActionEditorDialog({
  project,
  actions,
  action,
  onClose,
}: {
  readonly project: Project;
  readonly actions: readonly Action[];
  /** Undefined to add one. */
  readonly action?: Action;
  readonly onClose: () => void;
}): ReactNode {
  const [draft, setDraft] = useState<ActionDraft>(() =>
    action ? actionDraftOf(action) : NEW_ACTION_DRAFT,
  );
  const [problems, setProblems] = useState<readonly string[]>([]);
  const change = (fields: Partial<ActionDraft>): void => setDraft({ ...draft, ...fields });
  const workflows = useQuery({
    ...ciRunQueries.workflows(project.id, project.baseBranch),
    enabled: draft.kind === "workflow",
  });
  const workflow = workflows.data?.workflows.find(({ id }) => id === draft.file);
  const saving = useSaveActions(project.id);
  const showToast = useToast();
  const setBy = (field: ActionField): TestTargetSetter | undefined => action?.setBy[field];
  const save = (): void => {
    const read = editedActionOf(
      draft,
      workflow ? fixedInputsOf(workflow, draft.inputs) : draft.inputs,
    );
    if ("problems" in read) return setProblems(read.problems);
    if (!action && actions.some(({ key }) => key === read.action.key)) {
      return setProblems([`${project.name} already has an Action ${read.action.key}.`]);
    }
    setProblems([]);
    const edited: EditedAction = read.action;
    saving.mutate(
      { actions: actionsWith(actions, { edited }) },
      {
        onSuccess: () => {
          showToast(
            action
              ? `${edited.name} saved. It applies from its next run.`
              : `${edited.name} added.`,
          );
          onClose();
        },
      },
    );
  };
  return (
    <Dialog
      size="large"
      keepsHeight
      title={action ? `Change ${action.name}` : "Add an Action"}
      onClose={onClose}
      actions={
        <Button loading={saving.isPending} onClick={save}>
          {action ? "Save" : "Add the Action"}
        </Button>
      }
    >
      <form
        className="dialog-stack action-editor"
        aria-label={action ? `Change ${action.name}` : "Add an Action"}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="action-editor-head">
          {action ? (
            <span className="command-editor-key">
              Key{" "}
              <Badge mono size="sm">
                {action.key}
              </Badge>
            </span>
          ) : (
            <Input
              label="Key"
              hint='Lower-case letters, digits and "-"; fixed once added.'
              placeholder="install-phone"
              value={draft.key}
              onChange={(event) => change({ key: event.target.value })}
              autoFocus
              inputStyle={{ fontFamily: "var(--font-mono)" }}
            />
          )}
          <Marked setter={setBy("name")}>
            <Input
              label="Name"
              placeholder="Install on my phone"
              maxLength={ACTION_NAME_MAX_LENGTH}
              value={draft.name}
              onChange={(event) => change({ name: event.target.value })}
              autoFocus={action !== undefined}
            />
          </Marked>
        </div>
        <Marked setter={setBy("kind")}>
          <div className="test-target-field action-editor-kind">
            <span className="test-target-field-label">Kind</span>
            <RadioList
              label="Kind"
              name="action-kind"
              value={draft.kind}
              options={ACTION_KINDS.map((kind) => ({
                value: kind,
                label: (
                  <span className="action-kind-choice">
                    <span className="action-kind-choice-name">{ACTION_KIND_LABELS[kind]}</span>
                    <span className="action-kind-choice-line">{kindLine(kind, project.name)}</span>
                  </span>
                ),
              }))}
              onChange={(kind) => {
                const chosen = ACTION_KINDS.find((each) => each === kind);
                if (chosen) setDraft(withKind(draft, chosen));
              }}
            />
          </div>
        </Marked>
        <Marked setter={setBy("settings")}>
          <div className="action-editor-settings">
            {draft.kind === "project-command" && (
              <ProjectCommandFields project={project} draft={draft} change={change} />
            )}
            {draft.kind === "test-target" && (
              <TestTargetField project={project} draft={draft} change={change} />
            )}
            {draft.kind === "workflow" && (
              <WorkflowFields
                baseBranch={project.baseBranch}
                loading={workflows.isPending}
                error={workflows.error}
                problem={workflows.data?.problem ?? null}
                workflows={workflows.data?.workflows ?? []}
                workflow={workflow}
                draft={draft}
                change={change}
              />
            )}
          </div>
        </Marked>
        <Marked setter={setBy("leavesTheWorkstation")}>
          <Checkbox
            label="Leaves the workstation"
            description={`It pushes, publishes, deploys or releases: anything that reaches people or systems outside this Office. It then runs from ${project.baseBranch} only, after a confirm step.`}
            checked={draft.leavesTheWorkstation}
            onChange={(checked) => change({ leavesTheWorkstation: checked })}
          />
        </Marked>
        {problems.length > 0 && (
          <ul className="environment-reasons" role="alert">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        {saving.error && <RefusalAlert title="The Action wasn't saved" error={saving.error} />}
      </form>
    </Dialog>
  );
}

function ProjectCommandFields({
  project,
  draft,
  change,
}: {
  readonly project: Project;
  readonly draft: ActionDraft;
  readonly change: (fields: Partial<ActionDraft>) => void;
}): ReactNode {
  const listed = project.commands.some(({ key }) => key === draft.commandKey);
  const options = [
    // A command the Project no longer has stays shown, so the select says what the Action names.
    ...(draft.commandKey === "" || listed
      ? []
      : [{ value: draft.commandKey, label: draft.commandKey }]),
    ...project.commands.map(({ key, name }) => ({ value: key, label: `${key} · ${name}` })),
  ];
  const own = draft.timeLimitMinutes;
  return (
    <>
      <Select
        label="Command"
        placeholder={
          project.commands.length > 0
            ? `Pick one of ${project.name}'s commands`
            : `${project.name} has no commands yet`
        }
        disabled={project.commands.length === 0}
        options={options}
        value={draft.commandKey}
        onChange={(commandKey) => change({ commandKey })}
      />
      <CommandsBeforeField
        project={project}
        label="Commands before it"
        hint="Run in the checkout before the command, in this order."
        commandsBefore={draft.commandsBefore}
        change={(commandsBefore) => change({ commandsBefore })}
      />
      <div className="test-target-field" role="group" aria-label="Time limit">
        <span className="test-target-field-label">Time limit</span>
        {own === null ? (
          <div className="test-target-memory">
            <span className="test-target-memory-default">
              Default ({minutesWords(ACTION_TIME_LIMIT_MINUTES.default)})
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => change({ timeLimitMinutes: ACTION_TIME_LIMIT_MINUTES.default })}
            >
              Set its own limit
            </Button>
          </div>
        ) : (
          <div className="test-target-memory">
            <Stepper
              label="the time limit"
              value={own}
              min={ACTION_TIME_LIMIT_MINUTES.min}
              max={ACTION_TIME_LIMIT_MINUTES.max}
              step={timeLimitStep(own)}
              format={minutesWords}
              onChange={(minutes) =>
                change({
                  timeLimitMinutes: Math.min(
                    ACTION_TIME_LIMIT_MINUTES.max,
                    Math.max(ACTION_TIME_LIMIT_MINUTES.min, minutes),
                  ),
                })
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => change({ timeLimitMinutes: null })}
            >
              Use the default
            </Button>
          </div>
        )}
        <span className="test-target-field-hint">Its commands before it included.</span>
      </div>
      <p className="project-block-note test-target-editor-note">
        It gets {project.name}&apos;s variables and Secret variables, and{" "}
        {ACTION_RESERVED_VARIABLES.map((name, index) => (
          <Fragment key={name}>
            {index === 0 ? "" : index === ACTION_RESERVED_VARIABLES.length - 1 ? " and " : ", "}
            <code>{name}</code>
          </Fragment>
        ))}
        ; never The Office&apos;s own sign-ins. A token it needs goes in a Secret variable.
      </p>
    </>
  );
}

function TestTargetField({
  project,
  draft,
  change,
}: {
  readonly project: Project;
  readonly draft: ActionDraft;
  readonly change: (fields: Partial<ActionDraft>) => void;
}): ReactNode {
  const targets = useQuery(projectQueries.testTargets(project.id));
  if (targets.error) {
    return <RefusalAlert title="The test targets can't be read" error={targets.error} />;
  }
  if (!targets.data) return null;
  const listed = targets.data.targets;
  if (listed.length === 0 && draft.targetKey === "") {
    return (
      <p className="project-block-note">
        {project.name} has no test targets yet.{" "}
        <Link to="/projects/$projectId/test-targets" params={{ projectId: project.id }}>
          Add one under Test targets
        </Link>
      </p>
    );
  }
  const known = listed.some(({ key }) => key === draft.targetKey);
  return (
    <Select
      label="Test target"
      hint="Build to install and Install on a device are what it is meant for; a Hosted target runs as long as its instance does."
      placeholder={`Pick one of ${project.name}'s test targets`}
      options={[
        ...(draft.targetKey === "" || known
          ? []
          : [{ value: draft.targetKey, label: draft.targetKey }]),
        ...listed.map(({ key, name, kind }) => ({
          value: key,
          label: `${name} · ${TEST_TARGET_KIND_LABELS[kind]}`,
        })),
      ]}
      value={draft.targetKey}
      onChange={(targetKey) => change({ targetKey })}
    />
  );
}

/**
 * The Workflow file, among those on the base branch that declare a start by hand, as Start a
 * workflow reads them, then one control per input it declares, fixed with the Action.
 */
function WorkflowFields({
  baseBranch,
  loading,
  error,
  problem,
  workflows,
  workflow,
  draft,
  change,
}: {
  readonly baseBranch: string;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly problem: string | null;
  readonly workflows: readonly ManualWorkflow[];
  readonly workflow: ManualWorkflow | undefined;
  readonly draft: ActionDraft;
  readonly change: (fields: Partial<ActionDraft>) => void;
}): ReactNode {
  if (error) return <Alert tone="danger" title={error.message} />;
  if (loading) return <p className="project-block-note">Reading the workflows on {baseBranch}…</p>;
  if (problem !== null) return <Alert tone="warning" title={problem} />;
  if (workflows.length === 0 && draft.file === "") {
    return (
      <p className="project-block-note">No workflow on {baseBranch} can be started by hand.</p>
    );
  }
  const values = workflow ? workflowInputValuesOf(workflow, draft.inputs) : {};
  const undeclared = workflow ? undeclaredInputsOf(workflow, draft.inputs) : [];
  return (
    <>
      <Select
        label="Workflow file"
        placeholder="Choose a workflow"
        options={[
          ...(draft.file === "" || workflow ? [] : [{ value: draft.file, label: draft.file }]),
          ...workflows.map(({ id, name }) => ({
            value: id,
            label: name === "" || name === id ? id : `${name} · ${id}`,
          })),
        ]}
        value={draft.file}
        onChange={(file) => change({ file, inputs: {} })}
      />
      {workflow?.inputs.map((input) => (
        <WorkflowInputControl
          key={`${workflow.id}/${input.name}`}
          input={input}
          value={values[input.name] ?? ""}
          hint="Fixed with the Action: nothing is asked at its start."
          onChange={(value) => change({ inputs: { ...draft.inputs, [input.name]: value } })}
        />
      ))}
      {workflow &&
        undeclared.map((name) => (
          <Alert
            key={name}
            tone="warning"
            title={undeclaredInputWords(name, workflow.id, baseBranch)}
          />
        ))}
    </>
  );
}

/** The inputs the Action fixed that the file no longer declares, which saving leaves out. */
function undeclaredInputsOf(
  workflow: ManualWorkflow,
  entered: Readonly<Record<string, string>>,
): string[] {
  const declared = new Set(workflow.inputs.map(({ name }) => name));
  return Object.keys(entered).filter((name) => !declared.has(name));
}

/** The inputs the Action fixes: each declared one's value, an empty one left out for its default. */
function fixedInputsOf(
  workflow: ManualWorkflow,
  entered: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(workflowInputValuesOf(workflow, entered)).filter(([, value]) => value !== ""),
  );
}

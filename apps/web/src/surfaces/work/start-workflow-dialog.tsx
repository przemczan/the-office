import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ManualWorkflow, Project, RefList, WorkflowInput } from "@the-office/contracts";
import { Alert, Button, Dialog, Input, SearchableSelect, Select, Switch } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { ciRunQueries, startWorkflow } from "../../api/ci-runs.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import {
  CHOOSE_OPTION,
  CHOOSE_PROJECT,
  CHOOSE_WORKFLOW,
  CLEAR_REF,
  LOADING_WORKFLOWS,
  NO_PROJECT_TO_START_IN,
  NO_REF_MATCHES,
  noWorkflowOn,
  PROJECT_LABEL,
  REF_HINT,
  REF_LABEL,
  REF_PLACEHOLDER,
  START,
  START_A_WORKFLOW,
  START_A_WORKFLOW_HINT,
  START_REFUSED,
  startedToast,
  tagLabel,
  WORKFLOW_LABEL,
  whyStartDisabled,
} from "./ci-run-words.ts";

/**
 * Work › CI's Start a workflow: a workflow whose file declares a start by hand starts on a branch
 * or tag of the Project's repository, with one control per input its file there declares.
 */
export function StartWorkflowDialog({
  projects,
  presetProjectId,
  onClose,
}: {
  /** The Projects it can start in: those Work › CI lists. */
  readonly projects: readonly Project[];
  /** The Project it starts in, its choice hidden; undefined to choose one. */
  readonly presetProjectId?: string;
  readonly onClose: () => void;
}): ReactNode {
  const [chosenProjectId, setChosenProjectId] = useState<string | undefined>();
  const onlyProject = projects.length === 1 ? projects[0]?.id : undefined;
  const projectId = presetProjectId ?? chosenProjectId ?? onlyProject ?? "";
  const refs = useQuery({ ...ciRunQueries.refs(projectId), enabled: projectId !== "" });
  // The base branch until the user picks another; "" once they clear it.
  const [chosenRef, setChosenRef] = useState<string | undefined>();
  const ref = chosenRef ?? refs.data?.baseBranch ?? "";
  const workflows = useQuery({
    ...ciRunQueries.workflows(projectId, ref),
    enabled: projectId !== "" && ref !== "",
  });
  const [workflowId, setWorkflowId] = useState("");
  const workflow = workflows.data?.workflows.find(({ id }) => id === workflowId);
  // What the user entered, by input name, over the inputs' defaults; emptied on another workflow.
  const [entered, setEntered] = useState<Readonly<Record<string, string>>>({});
  const values = workflow ? valuesOf(workflow, entered) : {};
  const missing = (workflow?.inputs ?? [])
    .filter(({ name, required }) => required && (values[name] ?? "").trim() === "")
    .map(({ name }) => name);
  const whyDisabled = whyStartDisabled({ ref, workflowChosen: workflow !== undefined, missing });

  const queryClient = useQueryClient();
  const showToast = useToast();
  const starting = useMutation({
    mutationFn: () => startWorkflow(projectId, workflowId, ref, values),
    onSuccess: async () => {
      showToast(startedToast(workflow?.name ?? workflowId, ref));
      onClose();
      await queryClient.invalidateQueries({ queryKey: ["ci-runs"] });
    },
  });
  const chooseWorkflow = (id: string): void => {
    setWorkflowId(id);
    setEntered({});
  };
  const chooseRef = (next: string): void => {
    setChosenRef(next);
    chooseWorkflow("");
  };
  const chooseProject = (next: string): void => {
    setChosenProjectId(next);
    setChosenRef(undefined);
    chooseWorkflow("");
  };

  return (
    <Dialog
      size="medium"
      keepsHeight
      title={START_A_WORKFLOW}
      onClose={onClose}
      actions={
        <Button
          loading={starting.isPending}
          disabled={whyDisabled !== undefined}
          title={whyDisabled}
          onClick={() => starting.mutate()}
        >
          {START}
        </Button>
      }
    >
      <div className="dialog-stack">
        <p className="dialog-text">{START_A_WORKFLOW_HINT}</p>
        {presetProjectId === undefined &&
          (projects.length === 0 ? (
            <p className="dialog-text">{NO_PROJECT_TO_START_IN}</p>
          ) : (
            <Select
              label={PROJECT_LABEL}
              placeholder={CHOOSE_PROJECT}
              value={projectId}
              options={projects.map(({ id, name }) => ({ value: id, label: name }))}
              onChange={chooseProject}
            />
          ))}
        {refs.error && <Alert tone="danger" title={refs.error.message} />}
        {refs.data?.problem != null && <Alert tone="warning" title={refs.data.problem} />}
        {projectId !== "" && (
          <SearchableSelect
            label={REF_LABEL}
            hint={REF_HINT}
            placeholder={REF_PLACEHOLDER}
            value={ref}
            options={refOptions(refs.data, ref)}
            clearLabel={CLEAR_REF}
            noMatches={NO_REF_MATCHES}
            onChange={chooseRef}
          />
        )}
        {/* Said once: without a sign-in both reads answer the same problem. */}
        {ref !== "" &&
          (refs.data?.problem == null || workflows.data?.problem !== refs.data.problem) && (
            <WorkflowChoice
              at={ref}
              loading={workflows.isPending}
              error={workflows.error}
              problem={workflows.data?.problem ?? null}
              workflows={workflows.data?.workflows ?? []}
              workflowId={workflowId}
              onChange={chooseWorkflow}
            />
          )}
        {workflow?.inputs.map((input) => (
          <InputControl
            key={`${workflow.id}/${input.name}`}
            input={input}
            value={values[input.name] ?? ""}
            onChange={(value) => setEntered((before) => ({ ...before, [input.name]: value }))}
          />
        ))}
        {starting.error && <RefusalAlert title={START_REFUSED} error={starting.error} />}
      </div>
    </Dialog>
  );
}

function WorkflowChoice({
  at,
  loading,
  error,
  problem,
  workflows,
  workflowId,
  onChange,
}: {
  readonly at: string;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly problem: string | null;
  readonly workflows: readonly ManualWorkflow[];
  readonly workflowId: string;
  readonly onChange: (workflowId: string) => void;
}): ReactNode {
  if (error) return <Alert tone="danger" title={error.message} />;
  if (loading) return <p className="dialog-text">{LOADING_WORKFLOWS}</p>;
  if (problem !== null) return <Alert tone="warning" title={problem} />;
  if (workflows.length === 0) return <p className="dialog-text">{noWorkflowOn(at)}</p>;
  return (
    <Select
      label={WORKFLOW_LABEL}
      placeholder={CHOOSE_WORKFLOW}
      value={workflowId}
      options={workflows.map(({ id, name }) => ({ value: id, label: name || id }))}
      onChange={onChange}
    />
  );
}

/** One input's control: a text field, a switch, a choice of its options or a number field. */
function InputControl({
  input,
  value,
  onChange,
}: {
  readonly input: WorkflowInput;
  readonly value: string;
  readonly onChange: (value: string) => void;
}): ReactNode {
  const hint = input.description === "" ? undefined : input.description;
  switch (input.kind) {
    case "yes-no":
      return (
        <Switch
          label={input.name}
          description={hint}
          checked={value === "true"}
          onChange={(checked) => onChange(String(checked))}
        />
      );
    case "choice":
      return (
        <Select
          label={input.name}
          hint={hint}
          required={input.required}
          placeholder={CHOOSE_OPTION}
          value={value}
          options={[...input.options]}
          onChange={onChange}
        />
      );
    case "number":
    case "text":
    case "environment":
      return (
        <Input
          label={input.name}
          hint={hint}
          required={input.required}
          type={input.kind === "number" ? "number" : "text"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

/** Each input's value: what the user entered, else its default; a yes-no is "false" with neither. */
function valuesOf(
  workflow: ManualWorkflow,
  entered: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    workflow.inputs.map(({ name, kind, default: byDefault }) => [
      name,
      entered[name] ?? byDefault ?? (kind === "yes-no" ? "false" : ""),
    ]),
  );
}

/** The branches, then the tags as "v1.2.0 (tag)", with the chosen ref while the list lacks it. */
function refOptions(refs: RefList | undefined, ref: string): { value: string; label: string }[] {
  const branches = refs?.branches ?? [];
  const tags = (refs?.tags ?? []).filter((tag) => !branches.includes(tag));
  const options = [
    ...branches.map((branch) => ({ value: branch, label: branch })),
    ...tags.map((tag) => ({ value: tag, label: tagLabel(tag) })),
  ];
  return ref === "" || options.some(({ value }) => value === ref)
    ? options
    : [{ value: ref, label: ref }, ...options];
}

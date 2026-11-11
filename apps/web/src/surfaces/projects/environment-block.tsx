import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CheckState,
  CommandCheck,
  EnvironmentCheck,
  InstallCheck,
  Project,
  ProjectEnvironmentEdit,
  WorktreeCheck,
} from "@the-office/contracts";
import { Badge, Button, Icon, IconButton, Input, Textarea } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { ApiError } from "../../api/api-client.ts";
import { projectQueries, startEnvironmentCheck } from "../../api/projects.ts";
import { SecretValueInput } from "../../shell/secret-value-input.tsx";
import {
  checkBadge,
  commandCheckLabel,
  draftOf,
  environmentOf,
  runSummary,
  secretValueKept,
  withNewSecret,
  worktreeCheckDetail,
  worktreeCheckLabel,
  type EnvironmentDraft,
  type SecretVariableDraft,
} from "./environment-labels.ts";
import { ProjectBlock } from "./project-block.tsx";

const STATE_ICONS: Readonly<Record<CheckState, string>> = {
  waiting: "circle-dashed",
  running: "loader-circle",
  passed: "circle-check",
  failed: "circle-x",
  skipped: "circle-minus",
};

const STATE_LABELS: Readonly<Record<CheckState, string>> = {
  waiting: "Waiting",
  running: "Running",
  passed: "Passed",
  failed: "Failed",
  skipped: "Skipped",
};

/**
 * The Project's environment and its check (spec §5.5): the variables every command and Agent of
 * the Project runs with, tried in a fresh worktree of the base branch and saved only when install
 * and each of the Project's commands pass there.
 */
export function EnvironmentBlock({ project }: { readonly project: Project }): ReactNode {
  const check = useQuery(projectQueries.environmentCheck(project.id));
  const badge = checkBadge(check.data);
  return (
    <ProjectBlock
      icon="hard-drive"
      title="Environment"
      actions={
        check.data !== undefined && (
          <Badge tone={badge.tone} dot>
            {badge.label}
          </Badge>
        )
      }
      note="Every command and Agent of the Project runs with these. They are saved only when every check passes."
    >
      {check.error && (
        <p className="project-block-error" role="alert">
          {check.error.message}
        </p>
      )}
      {check.data === null && (
        <p className="project-block-text environment-unchecked">
          Not checked yet. The check opens a fresh worktree of {project.baseBranch} and runs
          install, then each of the Project's commands, there.
        </p>
      )}
      {check.data && <Checks check={check.data} project={project} />}
      {check.data !== undefined && (
        // Started again from the last check's environment once it finishes.
        <EnvironmentEditor
          key={`${check.data?.startedAt ?? "never"} ${check.data?.state ?? ""}`}
          project={project}
          check={check.data}
        />
      )}
    </ProjectBlock>
  );
}

function Checks({
  check,
  project,
}: {
  readonly check: EnvironmentCheck;
  readonly project: Project;
}): ReactNode {
  return (
    <ul className="environment-checks" aria-label="Environment checks">
      {check.checks.map((each) =>
        each.step === "worktree" ? (
          <WorktreeCheckLine key={each.step} check={each} project={project} />
        ) : (
          <CommandCheckLine
            key={each.step === "command" ? `command:${each.key}` : each.step}
            check={each}
          />
        ),
      )}
    </ul>
  );
}

function WorktreeCheckLine({
  check,
  project,
}: {
  readonly check: WorktreeCheck;
  readonly project: Project;
}): ReactNode {
  const detail = worktreeCheckDetail(check);
  return (
    <li className={`environment-check ${check.state}`}>
      <CheckIcon state={check.state} />
      <span className="environment-check-label">{worktreeCheckLabel(check, project)}</span>
      {detail !== undefined && (
        <span className="environment-check-meta">
          <span className="environment-check-detail">{detail}</span>
        </span>
      )}
    </li>
  );
}

function CommandCheckLine({ check }: { readonly check: InstallCheck | CommandCheck }): ReactNode {
  const outputId = useId();
  // A failed check shows its output until the user hides it.
  const [toggled, setToggled] = useState<boolean>();
  const showingOutput = toggled ?? check.state === "failed";
  const output = check.run?.output ?? "";
  return (
    <li className={`environment-check ${check.state}`}>
      <CheckIcon state={check.state} />
      <span className="environment-check-label">
        {commandCheckLabel(check)}
        {check.commandLine === "" ? (
          <span className="environment-check-detail">Not set</span>
        ) : (
          <code className="environment-check-command">{check.commandLine}</code>
        )}
      </span>
      {(check.run || output !== "") && (
        <span className="environment-check-meta">
          {check.run && <span className="environment-check-detail">{runSummary(check.run)}</span>}
          {output !== "" && (
            <button
              type="button"
              className="environment-check-toggle"
              aria-expanded={showingOutput}
              aria-controls={outputId}
              onClick={() => setToggled(!showingOutput)}
            >
              {showingOutput ? "Hide the output" : "Show the output"}
            </button>
          )}
        </span>
      )}
      {output !== "" && showingOutput && (
        <pre id={outputId} className="environment-check-output" aria-label="Output">
          {output}
        </pre>
      )}
    </li>
  );
}

function CheckIcon({ state }: { readonly state: CheckState }): ReactNode {
  return (
    <span className="environment-check-icon" role="img" aria-label={STATE_LABELS[state]}>
      <Icon name={STATE_ICONS[state]} size={15} />
    </span>
  );
}

/**
 * The environment as data, starting from what the last check tried: the Project's own when it
 * passed, and when it didn't, a try to fix rather than type again.
 */
function EnvironmentEditor({
  project,
  check,
}: {
  readonly project: Project;
  readonly check: EnvironmentCheck | null;
}): ReactNode {
  const formId = useId();
  const [draft, setDraft] = useState<EnvironmentDraft>(() =>
    draftOf(check?.environment ?? project.environment),
  );
  const [problems, setProblems] = useState<readonly string[]>([]);
  const queryClient = useQueryClient();
  const starting = useMutation({
    mutationFn: (environment: ProjectEnvironmentEdit) =>
      startEnvironmentCheck(project.id, environment),
    onSuccess: (started) => {
      queryClient.setQueryData(projectQueries.environmentCheck(project.id).queryKey, {
        check: started,
      });
    },
  });
  const running = check?.state === "running";
  const change = (fields: Partial<EnvironmentDraft>): void => setDraft({ ...draft, ...fields });
  const reasons =
    problems.length > 0
      ? problems
      : starting.error instanceof ApiError
        ? starting.error.reasons
        : starting.error
          ? [starting.error.message]
          : [];
  return (
    <form
      id={formId}
      className="environment-editor"
      onSubmit={(event) => {
        event.preventDefault();
        const read = environmentOf(draft);
        if ("problems" in read) return setProblems(read.problems);
        setProblems([]);
        starting.mutate(read.environment);
      }}
    >
      <Textarea
        label="Variables to set"
        hint="One NAME=value per line, such as JAVA_HOME=/opt/java-21."
        rows={3}
        value={draft.set}
        onChange={(event) => change({ set: event.target.value })}
        disabled={running}
        style={{ fontFamily: "var(--font-mono)" }}
      />
      <SecretVariables
        secrets={draft.secrets}
        change={(secrets) => change({ secrets })}
        add={() => setDraft(withNewSecret(draft))}
        disabled={running}
      />
      <Input
        label="Variables to remove"
        hint="Names The Office would pass on from its own environment, separated by commas."
        value={draft.unset}
        onChange={(event) => change({ unset: event.target.value })}
        disabled={running}
        inputStyle={{ fontFamily: "var(--font-mono)" }}
      />
      <Textarea
        label="Folders in front of PATH"
        hint="Full paths, one per line, searched in this order before the inherited PATH."
        rows={2}
        value={draft.prependPath}
        onChange={(event) => change({ prependPath: event.target.value })}
        disabled={running}
        style={{ fontFamily: "var(--font-mono)" }}
      />
      {reasons.length > 0 && (
        <ul className="environment-reasons" role="alert">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      <div className="environment-actions">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          iconLeft={<Icon name="play" size={14} />}
          loading={starting.isPending || running}
        >
          {running ? "Checking…" : "Run the environment check"}
        </Button>
      </div>
    </form>
  );
}

/**
 * The Project's Secret variables: given to its commands and Agents as the others are, their
 * values never shown again once saved and hidden wherever they would appear in output.
 */
function SecretVariables({
  secrets,
  change,
  add,
  disabled,
}: {
  readonly secrets: readonly SecretVariableDraft[];
  readonly change: (secrets: readonly SecretVariableDraft[]) => void;
  readonly add: () => void;
  readonly disabled: boolean;
}): ReactNode {
  const changeOne = (changed: SecretVariableDraft): void =>
    change(secrets.map((each) => (each.key === changed.key ? changed : each)));
  return (
    <div className="environment-secrets" role="group" aria-label="Secret variables">
      <div className="environment-secrets-head">
        <span className="environment-secrets-title">Secret variables</span>
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<Icon name="plus" size={14} />}
          onClick={add}
          disabled={disabled}
        >
          Add a Secret variable
        </Button>
      </div>
      <p className="project-block-note">
        {secrets.length === 0
          ? "None yet. Add one for a token a command needs, such as NPM_TOKEN; its value is never shown again once saved."
          : "A value is never shown again once saved, and shows as [secret NAME] in output. It takes one line of at least 6 characters."}
      </p>
      {secrets.map((secret) => (
        <SecretVariableRow
          key={secret.key}
          secret={secret}
          change={changeOne}
          remove={() => change(secrets.filter((each) => each.key !== secret.key))}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function SecretVariableRow({
  secret,
  change,
  remove,
  disabled,
}: {
  readonly secret: SecretVariableDraft;
  readonly change: (secret: SecretVariableDraft) => void;
  readonly remove: () => void;
  readonly disabled: boolean;
}): ReactNode {
  const called =
    secret.name.trim() === "" ? "the new Secret variable" : `the Secret variable ${secret.name}`;
  return (
    <fieldset className="environment-secret" aria-label={called}>
      <Input
        label="Name"
        value={secret.name}
        onChange={(event) => change({ ...secret, name: event.target.value })}
        disabled={disabled}
        inputStyle={{ fontFamily: "var(--font-mono)" }}
      />
      <SecretValueInput
        label="Value"
        typed={secret.typed}
        set={secretValueKept(secret)}
        change={(typed) => change({ ...secret, typed })}
        removable={false}
        disabled={disabled}
      />
      <IconButton
        size="sm"
        icon={<Icon name="x" size={14} />}
        label={`Remove ${called}`}
        onClick={remove}
        disabled={disabled}
      />
    </fieldset>
  );
}

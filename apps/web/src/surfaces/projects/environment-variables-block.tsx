import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Project, ProjectEnvironmentEdit } from "@the-office/contracts";
import { Button, Icon, IconButton, Input, Textarea } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { ApiError } from "../../api/api-client.ts";
import { projectQueries, saveEnvironment } from "../../api/projects.ts";
import { SecretValueInput } from "../../shell/secret-value-input.tsx";
import {
  draftChanged,
  draftOf,
  environmentOf,
  secretValueKept,
  withNewSecret,
  type EnvironmentDraft,
  type SecretVariableDraft,
} from "./environment-labels.ts";
import { ProjectBlock } from "./project-block.tsx";

/**
 * The Project's environment (spec §5.5): the variables every command and Agent of the Project runs
 * with, its Secret variables among them, saved as a whole by Save.
 */
export function EnvironmentVariablesBlock({ project }: { readonly project: Project }): ReactNode {
  return (
    <ProjectBlock
      icon="hard-drive"
      title="Environment variables"
      note="Every command and Agent of the Project runs with these once saved."
    >
      {/* Starts again from the saved environment whenever it changes, by this page's Save or elsewhere. */}
      <EnvironmentEditor key={JSON.stringify(project.environment)} project={project} />
    </ProjectBlock>
  );
}

function EnvironmentEditor({ project }: { readonly project: Project }): ReactNode {
  const [draft, setDraft] = useState<EnvironmentDraft>(() => draftOf(project.environment));
  const [problems, setProblems] = useState<readonly string[]>([]);
  const queryClient = useQueryClient();
  const saving = useMutation({
    mutationFn: (environment: ProjectEnvironmentEdit) => saveEnvironment(project.id, environment),
    onSuccess: (saved) => {
      queryClient.setQueryData(projectQueries.one(saved.id).queryKey, saved);
      // The answer may equal the environment held, which keeps this editor: start it again here.
      setDraft(draftOf(saved.environment));
    },
  });
  const changed = draftChanged(draft, project.environment);
  const change = (fields: Partial<EnvironmentDraft>): void => setDraft({ ...draft, ...fields });
  const reasons =
    problems.length > 0
      ? problems
      : saving.error instanceof ApiError
        ? saving.error.reasons
        : saving.error
          ? [saving.error.message]
          : [];
  return (
    <form
      className="environment-editor"
      aria-label="Environment variables"
      onSubmit={(event) => {
        event.preventDefault();
        const read = environmentOf(draft);
        if ("problems" in read) return setProblems(read.problems);
        setProblems([]);
        saving.mutate(read.environment);
      }}
    >
      <Textarea
        label="Variables to set"
        hint="One NAME=value per line, such as JAVA_HOME=/opt/java-21."
        rows={3}
        value={draft.set}
        onChange={(event) => change({ set: event.target.value })}
        disabled={saving.isPending}
        style={{ fontFamily: "var(--font-mono)" }}
      />
      <SecretVariables
        secrets={draft.secrets}
        change={(secrets) => change({ secrets })}
        add={() => setDraft(withNewSecret(draft))}
        disabled={saving.isPending}
      />
      <Input
        label="Variables to remove"
        hint="Names The Office would pass on from its own environment, separated by commas."
        value={draft.unset}
        onChange={(event) => change({ unset: event.target.value })}
        disabled={saving.isPending}
        inputStyle={{ fontFamily: "var(--font-mono)" }}
      />
      <Textarea
        label="Folders in front of PATH"
        hint="Full paths, one per line, searched in this order before the inherited PATH."
        rows={2}
        value={draft.prependPath}
        onChange={(event) => change({ prependPath: event.target.value })}
        disabled={saving.isPending}
        style={{ fontFamily: "var(--font-mono)" }}
      />
      {reasons.length > 0 && (
        <ul className="environment-reasons" role="alert">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      <div className="project-row">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={saving.isPending}
          disabled={!changed}
          title={changed ? undefined : "Change a variable to save."}
        >
          Save
        </Button>
        {changed && (
          <Button
            variant="secondary"
            size="sm"
            disabled={saving.isPending}
            onClick={() => {
              saving.reset();
              setProblems([]);
              setDraft(draftOf(project.environment));
            }}
          >
            Discard
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * The Project's Secret variables, or a test target's: given to what runs as the others are, their
 * values never shown again once saved and hidden wherever they would appear in output.
 */
export function SecretVariables({
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

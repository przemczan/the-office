import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  testTargetKindSchema,
  type EditedTestTarget,
  type EntryPointKind,
  type Project,
  type Proposal,
  type TestTarget,
  type TestTargetField,
  type TestTargetSetter,
} from "@the-office/contracts";
import {
  Badge,
  Button,
  Icon,
  IconButton,
  Input,
  SegmentedControl,
  Select,
  Textarea,
} from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { proposalQueries } from "../../api/conversations.ts";
import { projectQueries, saveTestTargets } from "../../api/projects.ts";
import { useDevops } from "../../shell/ask-devops.tsx";
import { ProposalCard } from "../../shell/conversation/proposal-card.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import {
  BUILT_TEST_TARGET_KINDS,
  ENTRY_POINT_KIND_LABELS,
  entryPointWords,
  TEST_TARGET_KIND_LABELS,
} from "../../shell/test-target-words.ts";
import { useToast } from "../../shell/toasts.tsx";
import { useSignedInUserId } from "../../shell/use-user-name.ts";
import { SecretVariables } from "./environment-variables-block.tsx";
import { ProjectBlock } from "./project-block.tsx";
import {
  editedTestTargetOf,
  NEW_TEST_TARGET_DRAFT,
  needsRunEnvironment,
  secretsNeedingValues,
  setByWords,
  targetSetByWords,
  testTargetDraftOf,
  testTargetsWith,
  withNewTargetSecret,
  type TestTargetDraft,
} from "./test-target-words.ts";

const KIND_OPTIONS = testTargetKindSchema.options.map((kind) => {
  const built = BUILT_TEST_TARGET_KINDS.includes(kind);
  return {
    value: kind,
    label: built ? (
      TEST_TARGET_KIND_LABELS[kind]
    ) : (
      // The design system's segments can't be disabled, so an outlined kind looks it and is ignored.
      <span className="test-target-kind-outlined" aria-disabled="true">
        {TEST_TARGET_KIND_LABELS[kind]}
      </span>
    ),
    ...(built ? {} : { title: "Not built yet" }),
  };
});

const ENTRY_POINT_KINDS: readonly EntryPointKind[] = [
  "repository-file",
  "package-script",
  "gradle-task",
  "devcontainer-service",
];

const ENTRY_POINT_OPTIONS = ENTRY_POINT_KINDS.map((kind) => ({
  value: kind,
  label: ENTRY_POINT_KIND_LABELS[kind],
}));

/** What the block edits in place: a target by its key, or a new one. */
type Editing = { readonly key: string } | "new";

/**
 * The Project's test targets (spec §2.12): what can be launched on an Initiative's branch, each
 * edited in place and saved with the whole list; above them, Devops' open Proposal of them.
 */
export function TestTargetsBlock({ project }: { readonly project: Project }): ReactNode {
  const read = useQuery(projectQueries.testTargets(project.id));
  const [editing, setEditing] = useState<Editing>();
  const devops = useDevops();
  const keep = useSavedTestTargets(project.id);
  const showToast = useToast();
  const targets = read.data?.targets;
  const removing = useMutation({
    mutationFn: (target: TestTarget) =>
      saveTestTargets(project.id, {
        targets: testTargetsWith(targets ?? [], { removedKey: target.key }),
      }),
    onSuccess: (saved, target) => {
      keep(saved.targets);
      showToast(`${target.name} removed.`);
    },
  });
  const done = (): void => setEditing(undefined);
  return (
    <ProjectBlock icon="flask-conical" title="Test targets">
      <p className="project-block-text">
        What can be launched on an Initiative&apos;s branch to try the work. Kept in The Office,
        never in the repository.
      </p>
      <OpenProposals projectId={project.id} />
      {read.error && <RefusalAlert title="The test targets can't be read" error={read.error} />}
      {targets && (
        <>
          {targets.length === 0 && editing !== "new" && (
            <p className="project-block-note">
              None yet. Add one, or have {devops?.card.name ?? "Devops"} set them up from the
              repository.
            </p>
          )}
          {(targets.length > 0 || editing === "new") && (
            <div className="commands test-targets">
              {targets.map((target) =>
                typeof editing === "object" && editing.key === target.key ? (
                  <TestTargetEditor
                    key={target.key}
                    project={project}
                    targets={targets}
                    target={target}
                    onDone={done}
                  />
                ) : (
                  <TestTargetRow
                    key={target.key}
                    project={project}
                    target={target}
                    disabled={removing.isPending}
                    onChange={() => setEditing({ key: target.key })}
                    onRemove={() => {
                      setEditing(undefined);
                      removing.mutate(target);
                    }}
                  />
                ),
              )}
              {editing === "new" && (
                <TestTargetEditor project={project} targets={targets} onDone={done} />
              )}
            </div>
          )}
          {removing.error && <RefusalAlert title="Nothing was removed" error={removing.error} />}
          {editing !== "new" && (
            <div className="commands-actions">
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<Icon name="plus" size={14} />}
                onClick={() => {
                  removing.reset();
                  setEditing("new");
                }}
              >
                Add a test target
              </Button>
            </div>
          )}
        </>
      )}
    </ProjectBlock>
  );
}

/** Devops' open Proposals of this Project's test targets, each as its card in the chat. */
function OpenProposals({ projectId }: { readonly projectId: string }): ReactNode {
  const open = useQuery(proposalQueries.open()).data ?? [];
  const shown = open.filter(
    ({ change }: Proposal) => change.kind === "test-targets" && change.projectId === projectId,
  );
  if (shown.length === 0) return null;
  return (
    <div className="test-targets-proposals">
      {shown.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} />
      ))}
    </div>
  );
}

function useSavedTestTargets(projectId: string): (targets: readonly TestTarget[]) => void {
  const queryClient = useQueryClient();
  return (targets) =>
    queryClient.setQueryData(projectQueries.testTargets(projectId).queryKey, {
      targets: [...targets],
    });
}

function TestTargetRow({
  project,
  target,
  disabled,
  onChange,
  onRemove,
}: {
  readonly project: Project;
  readonly target: TestTarget;
  readonly disabled: boolean;
  readonly onChange: () => void;
  readonly onRemove: () => void;
}): ReactNode {
  const signedInUserId = useSignedInUserId();
  const setBy = targetSetByWords(target, signedInUserId);
  const missing = secretsNeedingValues(target);
  return (
    <div className="command-row test-target-row" role="group" aria-label={target.name}>
      <span className="command-key">{target.name}</span>
      <code className="command-line">{entryPointWords(target.entryPoint)}</code>
      <span className="command-meta">
        <Badge mono size="sm">
          {target.key}
        </Badge>
        <Badge size="sm">{TEST_TARGET_KIND_LABELS[target.kind]}</Badge>
      </span>
      {setBy !== undefined && <span className="test-target-set-by">{setBy}</span>}
      <IconButton
        icon={<Icon name="pencil" size={14} />}
        label={`Change ${target.name}`}
        size="sm"
        disabled={disabled}
        onClick={onChange}
      />
      <IconButton
        icon={<Icon name="trash-2" size={14} />}
        label={`Remove ${target.name}`}
        size="sm"
        disabled={disabled}
        onClick={onRemove}
      />
      {(missing.length > 0 || needsRunEnvironment(target, project.runEnvironment)) && (
        <div className="test-target-warnings">
          {missing.map((name) => (
            <span key={name} className="test-target-warning">
              <Icon name="triangle-alert" size={13} />
              Needs a value: {name}
            </span>
          ))}
          {needsRunEnvironment(target, project.runEnvironment) && (
            <span className="test-target-warning">
              <Icon name="triangle-alert" size={13} />
              Needs Run environment On to launch.{" "}
              <Link to="/projects/$projectId/run-environment" params={{ projectId: project.id }}>
                Run environment
              </Link>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A target's fields changed in place, or a new target with its key too, saved with the whole
 * list: the key is fixed once added.
 */
function TestTargetEditor({
  project,
  targets,
  target,
  onDone,
}: {
  readonly project: Project;
  readonly targets: readonly TestTarget[];
  /** Undefined for a new target. */
  readonly target?: TestTarget;
  readonly onDone: () => void;
}): ReactNode {
  const [draft, setDraft] = useState<TestTargetDraft>(() =>
    target ? testTargetDraftOf(target) : NEW_TEST_TARGET_DRAFT,
  );
  const [problems, setProblems] = useState<readonly string[]>([]);
  const keep = useSavedTestTargets(project.id);
  const showToast = useToast();
  const saving = useMutation({
    mutationFn: (edited: EditedTestTarget) =>
      saveTestTargets(project.id, { targets: testTargetsWith(targets, { edited }) }),
    onSuccess: (saved, edited) => {
      keep(saved.targets);
      showToast(
        target ? `${edited.name} saved. It applies from its next launch.` : `${edited.name} added.`,
      );
      onDone();
    },
  });
  const change = (fields: Partial<TestTargetDraft>): void => setDraft({ ...draft, ...fields });
  const cancelOnEscape = (event: { readonly key: string }): void => {
    if (event.key === "Escape") onDone();
  };
  const save = (): void => {
    const read = editedTestTargetOf(draft);
    if ("problems" in read) return setProblems(read.problems);
    if (!target && targets.some(({ key }) => key === read.target.key)) {
      return setProblems([`${project.name} already has a test target ${read.target.key}.`]);
    }
    setProblems([]);
    saving.mutate(read.target);
  };
  const setBy = (field: TestTargetField): TestTargetSetter | undefined => target?.setBy[field];
  return (
    <form
      className="command-editor test-target-editor"
      aria-label={target ? `Change ${target.name}` : "Add a test target"}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="command-editor-fields test-target-editor-fields">
        {target ? (
          <span className="command-editor-key">
            Key{" "}
            <Badge mono size="sm">
              {target.key}
            </Badge>
          </span>
        ) : (
          <Input
            label="Key"
            hint='Lower-case letters, digits and "-"; fixed once added.'
            placeholder="web"
            value={draft.key}
            onChange={(event) => change({ key: event.target.value })}
            onKeyDown={cancelOnEscape}
            autoFocus
            size="sm"
            inputStyle={{ fontFamily: "var(--font-mono)" }}
          />
        )}
        <Marked setter={setBy("name")}>
          <Input
            label="Name"
            placeholder="Web app"
            value={draft.name}
            onChange={(event) => change({ name: event.target.value })}
            onKeyDown={cancelOnEscape}
            autoFocus={target !== undefined}
            size="sm"
          />
        </Marked>
      </div>
      <Marked setter={setBy("kind")}>
        <div className="test-target-field" role="group" aria-label="Kind">
          <span className="test-target-field-label">Kind</span>
          <SegmentedControl
            size="sm"
            options={KIND_OPTIONS}
            value={draft.kind}
            onChange={(kind) => {
              const chosen = testTargetKindSchema.parse(kind);
              if (BUILT_TEST_TARGET_KINDS.includes(chosen)) change({ kind: chosen });
            }}
          />
        </div>
      </Marked>
      <Marked setter={setBy("entryPoint")}>
        <EntryPointFields draft={draft} change={change} onKeyDown={cancelOnEscape} />
      </Marked>
      {draft.kind === "build-to-install" ? (
        <Marked setter={setBy("outputPatterns")}>
          <Textarea
            label="Output files"
            hint="One pattern per line, from the repository's root; * and ** allowed."
            placeholder="composeApp/build/outputs/apk/debug/*.apk"
            rows={2}
            value={draft.outputPatterns}
            onChange={(event) => change({ outputPatterns: event.target.value })}
            style={{ fontFamily: "var(--font-mono)" }}
          />
        </Marked>
      ) : (
        <Marked setter={setBy("port")}>
          <Input
            label="Port"
            hint="The port the app listens on inside its container."
            inputMode="numeric"
            placeholder="3000"
            value={draft.port}
            onChange={(event) => change({ port: event.target.value })}
            onKeyDown={cancelOnEscape}
            size="sm"
          />
        </Marked>
      )}
      <Marked setter={setBy("variables")}>
        <Textarea
          label="Variables"
          hint="One NAME=value per line."
          rows={2}
          value={draft.variables}
          onChange={(event) => change({ variables: event.target.value })}
          style={{ fontFamily: "var(--font-mono)" }}
        />
      </Marked>
      <Marked setter={setBy("secretVariables")}>
        <SecretVariables
          secrets={draft.secrets}
          change={(secrets) => change({ secrets })}
          add={() => setDraft(withNewTargetSecret(draft))}
          disabled={saving.isPending}
        />
      </Marked>
      <p className="project-block-note test-target-editor-note">
        Test values only: a test instance never gets the Project&apos;s own variables.
      </p>
      {problems.length > 0 && (
        <ul className="environment-reasons" role="alert">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {saving.error && <RefusalAlert title="The test target wasn't saved" error={saving.error} />}
      <div className="command-editor-actions">
        <Button type="submit" variant="primary" size="sm" loading={saving.isPending}>
          Save
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The entry point's kind, then what it names, then its arguments (none for a service). */
function EntryPointFields({
  draft,
  change,
  onKeyDown,
}: {
  readonly draft: TestTargetDraft;
  readonly change: (fields: Partial<TestTargetDraft>) => void;
  readonly onKeyDown: (event: { readonly key: string }) => void;
}): ReactNode {
  const text = (
    label: string,
    field: "path" | "manifest" | "script" | "task" | "service",
    placeholder: string,
  ): ReactNode => (
    <Input
      label={label}
      placeholder={placeholder}
      value={draft[field]}
      onChange={(event) => change({ [field]: event.target.value })}
      onKeyDown={onKeyDown}
      size="sm"
      inputStyle={{ fontFamily: "var(--font-mono)" }}
    />
  );
  return (
    <div className="test-target-entry-point">
      <div className="command-editor-fields">
        <Select
          label="Entry point"
          hint="One of the repository's own entry points: no shell."
          options={ENTRY_POINT_OPTIONS}
          value={draft.entryPointKind}
          onChange={(kind) => {
            const chosen = ENTRY_POINT_KINDS.find((each) => each === kind);
            if (chosen) change({ entryPointKind: chosen });
          }}
          size="sm"
        />
        {draft.entryPointKind === "repository-file" &&
          text("Path", "path", "scripts/start-test.sh")}
        {draft.entryPointKind === "package-script" && (
          <>
            {text("Package manifest", "manifest", "package.json")}
            {text("Script", "script", "start")}
          </>
        )}
        {draft.entryPointKind === "gradle-task" && text("Task", "task", "assembleDebug")}
        {draft.entryPointKind === "devcontainer-service" && text("Service", "service", "web")}
      </div>
      {draft.entryPointKind !== "devcontainer-service" && (
        <Textarea
          label="Arguments"
          hint="One per line, given as they are."
          rows={2}
          value={draft.arguments}
          onChange={(event) => change({ arguments: event.target.value })}
          style={{ fontFamily: "var(--font-mono)" }}
        />
      )}
    </div>
  );
}

/** A field with who set it last beside it, when anyone is known. */
function Marked({
  setter,
  children,
}: {
  readonly setter: TestTargetSetter | undefined;
  readonly children: ReactNode;
}): ReactNode {
  const signedInUserId = useSignedInUserId();
  if (!setter) return children;
  return (
    <div className="test-target-marked">
      {children}
      <span className="test-target-set-by">{setByWords(setter, signedInUserId)}</span>
    </div>
  );
}

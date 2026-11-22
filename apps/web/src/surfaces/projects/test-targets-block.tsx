import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  DEFAULT_PORT_VARIABLE,
  gigabytesOf,
  MEMORY_PER_SERVICE_MEGABYTES,
  testTargetKindSchema,
  type EditedTestTarget,
  type EntryPointKind,
  type Project,
  type Proposal,
  type ProjectTestTargetsChat,
  type TestTarget,
  type TestTargetsChat,
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
  Stepper,
  Textarea,
  TextButton,
} from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { proposalQueries } from "../../api/conversations.ts";
import { useOfficeEvent } from "../../api/event-stream-provider.tsx";
import { askTestTargetsChat, projectQueries, saveTestTargets } from "../../api/projects.ts";
import { runEnvironmentOfficeLimitsQuery } from "../../api/run-environments.ts";
import { useDevops } from "../../shell/ask-devops.tsx";
import { useOpenWithDraft } from "../../shell/chat/ask-in-chat.tsx";
import { useChat } from "../../shell/chat/use-chat.tsx";
import { PersonAvatar } from "../../shell/person-avatar.tsx";
import { ProposalCard } from "../../shell/conversation/proposal-card.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import {
  BUILT_TEST_TARGET_KINDS,
  ENTRY_POINT_KIND_LABELS,
  entryPointWords,
  TEST_TARGET_KIND_LABELS,
} from "../../shell/test-target-words.ts";
import { durationWords } from "../../shell/time.ts";
import { useToast } from "../../shell/toasts.tsx";
import { useClock } from "../../shell/use-clock.ts";
import { useDutyHolder } from "../../shell/use-duty-holder.ts";
import { useHired } from "../../shell/use-hired.ts";
import { useSignedInUserId } from "../../shell/use-user-name.ts";
import { SecretVariables } from "./environment-variables-block.tsx";
import { ProjectBlock } from "./project-block.tsx";
import { SetUpTaskLine } from "./set-up-task-line.tsx";
import {
  editedTestTargetOf,
  movedBy,
  NEW_TEST_TARGET_DRAFT,
  notACommandWords,
  needsRunEnvironment,
  secretsNeedingValues,
  setByWords,
  targetDetailsWords,
  targetSetByWords,
  testTargetDraftOf,
  testTargetsWith,
  runnableCommandsOf,
  unknownCommandKeys,
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

/** The memory a target starts its own limit at when the Office-wide value can't be read. */
const FIRST_OWN_MEMORY_MEGABYTES = 2048;

/** The Test targets card's id, which the Test instances card under it links to. */
export const TEST_TARGETS_ANCHOR = "test-targets";

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
  const followed = useQuery(projectQueries.testTargetsChat(project.id)).data;
  const nobodyOnboards = useDutyHolder("onboards-projects").fallback !== undefined;
  const asking = useAskTestTargets(project);
  const openTask = followed?.setUpTask ?? null;
  const chat = followed?.chat ?? null;
  const canAsk = followed !== undefined && openTask === null && chat === null;
  return (
    <ProjectBlock
      icon="flask-conical"
      title="Test targets"
      anchor={TEST_TARGETS_ANCHOR}
      actions={
        canAsk && devops?.card.capabilities.chat ? (
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Icon name="message-circle" size={14} />}
            loading={asking.isPending}
            onClick={() => asking.mutate()}
          >
            Ask {devops.card.name} to set up test targets
          </Button>
        ) : undefined
      }
    >
      <p className="project-block-text">
        What can be launched on an Initiative&apos;s branch to try the work. Kept in The Office,
        never in the repository.
      </p>
      {canAsk && nobodyOnboards && (
        <p className="project-block-note">
          Nobody onboards Projects yet: give Onboards and repairs Projects to someone in People.
        </p>
      )}
      {openTask && (
        <div className="off-board-task is-ready">
          <SetUpTaskLine task={openTask} />
          <p className="off-board-task-hint">
            Made before test targets were set up in a chat. It works as before; once it is Done or
            Dropped, the button asks in a chat.
          </p>
        </div>
      )}
      {!openTask && chat && (
        <TestTargetsChatLine
          project={project}
          chat={chat}
          asking={asking.isPending}
          onAskAgain={() => asking.mutate()}
        />
      )}
      {asking.error && <RefusalAlert title="Nothing was asked" error={asking.error} />}
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

/** The words the test targets chat opens with, waiting in its composer for the user to send. */
export function testTargetsDraftOf(projectName: string): string {
  return `Can you set up the test targets of ${projectName}? Read its repository, change no file, and propose them.`;
}

/** The followed Thread's events that move the chat's state: a message, a turn's end, its Proposal. */
const FOLLOWED_CHAT_EVENTS = [
  "thread.messages-logged",
  "thread.turn-ended",
  "thread.proposal-drafted",
  "thread.proposal-applied",
  "thread.proposal-declined",
] as const;

/**
 * Ask, or Ask again: the service starts a Thread in the chat of whoever onboards Projects, and the
 * chat drawer opens on it with the draft waiting; the card follows it from then on.
 */
function useAskTestTargets(project: Project) {
  const queryClient = useQueryClient();
  const openWithDraft = useOpenWithDraft();
  return useMutation({
    mutationFn: () => askTestTargetsChat(project.id),
    onSuccess: async (asked: ProjectTestTargetsChat) => {
      queryClient.setQueryData(projectQueries.testTargetsChat(project.id).queryKey, asked);
      if (asked.chat) {
        await openWithDraft(
          { id: asked.chat.threadId, roleKey: asked.chat.roleKey },
          testTargetsDraftOf(project.name),
        );
      }
    },
  });
}

/** Reads the followed chat again on its Thread's events, which no query key of the Project names. */
function useFollowedChatEvents(projectId: string, threadId: string): void {
  const queryClient = useQueryClient();
  const readAgain = (event: object): void => {
    if ("threadId" in event && event.threadId === threadId) {
      void queryClient.invalidateQueries({
        queryKey: projectQueries.testTargetsChat(projectId).queryKey,
      });
    }
  };
  useOfficeEvent(FOLLOWED_CHAT_EVENTS[0], readAgain);
  useOfficeEvent(FOLLOWED_CHAT_EVENTS[1], readAgain);
  useOfficeEvent(FOLLOWED_CHAT_EVENTS[2], readAgain);
  useOfficeEvent(FOLLOWED_CHAT_EVENTS[3], readAgain);
  useOfficeEvent(FOLLOWED_CHAT_EVENTS[4], readAgain);
}

const CHAT_BADGES: Readonly<
  Record<
    TestTargetsChat["state"],
    { readonly label: string; readonly tone: "neutral" | "info" | "warning" | "accent" }
  >
> = {
  draft: { label: "Draft waiting", tone: "neutral" },
  answering: { label: "Answering", tone: "info" },
  "waiting-on-you": { label: "Waiting on you", tone: "warning" },
  proposal: { label: "Proposal ready", tone: "accent" },
};

const CHAT_CLASSES: Readonly<Record<TestTargetsChat["state"], string>> = {
  draft: "is-queued",
  answering: "is-running",
  "waiting-on-you": "is-waiting-on-you",
  proposal: "is-done",
};

/**
 * Where the test targets chat stands (docs/design/set-up-tasks.html, "The chat in flight"), with
 * Open the chat, and Ask again while no Proposal is open.
 */
function TestTargetsChatLine({
  project,
  chat,
  asking,
  onAskAgain,
}: {
  readonly project: Project;
  readonly chat: TestTargetsChat;
  readonly asking: boolean;
  readonly onAskAgain: () => void;
}): ReactNode {
  useFollowedChatEvents(project.id, chat.threadId);
  const person = useHired(chat.roleKey);
  const chatControls = useChat();
  const now = useClock();
  const name = person?.card.name ?? "Devops";
  const badge = CHAT_BADGES[chat.state];
  const title = {
    draft: `Asked ${name} in a chat`,
    answering: `${name} is reading the repository`,
    "waiting-on-you": `${name} replied in the chat`,
    proposal: `${name} proposed them in the chat`,
  }[chat.state];
  return (
    <section
      className={`off-board-task ${CHAT_CLASSES[chat.state]}`}
      aria-label={`Test targets chat · ${badge.label}`}
    >
      <div className="off-board-task-head">
        <Badge tone={badge.tone} dot>
          {badge.label}
        </Badge>
        <span className="off-board-task-title">{title}</span>
        <span className="off-board-task-end">
          <TextButton onClick={() => chatControls.open(chat.roleKey, chat.threadId)}>
            Open the chat
          </TextButton>
          {chat.state !== "proposal" && (
            <Button size="sm" variant="ghost" loading={asking} onClick={onAskAgain}>
              Ask again
            </Button>
          )}
        </span>
      </div>
      {chat.state === "draft" && (
        <p className="off-board-task-hint">Your draft waits in the chat for you to send it.</p>
      )}
      {chat.state === "answering" && (
        <div className="off-board-task-meta">
          <span className="off-board-task-person">
            <PersonAvatar roleKey={chat.roleKey} name={name} size="xs" />
            <strong>{name}</strong>
          </span>
          <span>For {durationWords(now.getTime() - Date.parse(chat.since))}</span>
          <span>In a chat, on the base branch {project.baseBranch}</span>
        </div>
      )}
      {chat.state === "proposal" && (
        <p className="off-board-task-hint">
          Apply or dismiss the Proposal below; the list stays as it is until it is applied.
        </p>
      )}
    </section>
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
  const unknown = unknownCommandKeys(target.commandsBefore, runnableCommandsOf(project));
  const details = targetDetailsWords(target);
  const needsOn = needsRunEnvironment(target, project.runEnvironment);
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
      {details.length > 0 && <span className="test-target-details">{details.join(" · ")}</span>}
      {(missing.length > 0 || unknown.length > 0 || needsOn) && (
        <div className="test-target-warnings">
          {missing.map((name) => (
            <span key={name} className="test-target-warning">
              <Icon name="triangle-alert" size={13} />
              Needs a value: {name}
            </span>
          ))}
          {unknown.map((key) => (
            <span key={`command-${key}`} className="test-target-warning">
              <Icon name="triangle-alert" size={13} />
              {notACommandWords(key)}
            </span>
          ))}
          {needsOn && (
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
      <Marked setter={setBy("commandsBefore")}>
        <CommandsBeforeField
          project={project}
          commandsBefore={draft.commandsBefore}
          change={(commandsBefore) => change({ commandsBefore })}
        />
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
        <div className="command-editor-fields test-target-editor-fields">
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
          <Marked setter={setBy("portVariable")}>
            <Input
              label="Port variable"
              hint="The variable The Office sets to the port."
              placeholder={DEFAULT_PORT_VARIABLE}
              value={draft.portVariable}
              onChange={(event) => change({ portVariable: event.target.value })}
              onKeyDown={cancelOnEscape}
              size="sm"
              inputStyle={{ fontFamily: "var(--font-mono)" }}
            />
          </Marked>
        </div>
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
        Test values only: a test instance never gets the Project&apos;s own variables. The Office
        sets <code>OFFICE_TEST_INSTANCE=true</code>
        {draft.kind === "build-to-install" ? (
          "."
        ) : (
          <>
            {" "}
            and <code>{draft.portVariable.trim() || DEFAULT_PORT_VARIABLE}</code> to the port.
          </>
        )}
      </p>
      <Marked setter={setBy("memoryMegabytes")}>
        <MemoryField
          memoryMegabytes={draft.memoryMegabytes}
          change={(memoryMegabytes) => change({ memoryMegabytes })}
          ignoredOnTheWorkstation={
            draft.kind === "build-to-install" && project.runEnvironment !== "on"
          }
        />
      </Marked>
      <p className="project-block-note test-target-editor-note">
        Tool settings go in the variables or the entry point&apos;s arguments, such as{" "}
        <code>-Dorg.gradle.jvmargs=-Xmx2g</code> for a Gradle task.
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

/**
 * The Project's commands run in the checkout before the entry point, in order: each can be moved
 * or removed, and one the Project no longer has is flagged.
 */
function CommandsBeforeField({
  project,
  commandsBefore,
  change,
}: {
  readonly project: Project;
  readonly commandsBefore: readonly string[];
  readonly change: (commandsBefore: readonly string[]) => void;
}): ReactNode {
  const runnable = runnableCommandsOf(project);
  const addable = runnable.filter(({ key }) => !commandsBefore.includes(key));
  const unknown = unknownCommandKeys(commandsBefore, runnable);
  return (
    <div className="test-target-field" role="group" aria-label="Commands before the entry point">
      <span className="test-target-field-label">Commands before the entry point</span>
      {commandsBefore.length > 0 && (
        <ol className="test-target-commands" aria-label="Commands before the entry point, in order">
          {commandsBefore.map((key, index) => {
            const command = runnable.find((each) => each.key === key);
            return (
              <li key={`${index}-${key}`} className="test-target-command">
                <span className="test-target-command-place">{index + 1}</span>
                <span className="test-target-command-words">
                  <code>{key}</code>
                  {command && <span className="test-target-command-name">{command.name}</span>}
                  {unknown.includes(key) && (
                    <span className="test-target-warning">
                      <Icon name="triangle-alert" size={13} />
                      {notACommandWords(key)}
                    </span>
                  )}
                </span>
                <span className="test-target-command-tools">
                  <IconButton
                    size="sm"
                    icon={<Icon name="chevron-up" size={14} />}
                    label={`Move ${key} up`}
                    disabled={index === 0}
                    onClick={() => change(movedBy(commandsBefore, index, -1))}
                  />
                  <IconButton
                    size="sm"
                    icon={<Icon name="chevron-down" size={14} />}
                    label={`Move ${key} down`}
                    disabled={index === commandsBefore.length - 1}
                    onClick={() => change(movedBy(commandsBefore, index, 1))}
                  />
                  <IconButton
                    size="sm"
                    icon={<Icon name="x" size={14} />}
                    label={`Remove ${key}`}
                    onClick={() => change(commandsBefore.filter((_, each) => each !== index))}
                  />
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <div className="test-target-command-add">
        <Select
          label="Add a command"
          hint="One of the Project's commands, run in the checkout before the entry point, in this order."
          placeholder={
            addable.length > 0 ? "Pick one of the Project's commands" : "Every command is listed"
          }
          disabled={addable.length === 0}
          options={addable.map(({ key, name }) => ({ value: key, label: `${name} (${key})` }))}
          value=""
          onChange={(key) => key !== "" && change([...commandsBefore, key])}
          size="sm"
        />
      </div>
    </div>
  );
}

/**
 * The target's own Memory per service, on a Stepper with the Office-wide setting's bounds, or the
 * Office default while it has none.
 */
function MemoryField({
  memoryMegabytes,
  change,
  ignoredOnTheWorkstation,
}: {
  readonly memoryMegabytes: number | null;
  readonly change: (memoryMegabytes: number | null) => void;
  readonly ignoredOnTheWorkstation: boolean;
}): ReactNode {
  const officeDefault = useQuery(runEnvironmentOfficeLimitsQuery()).data?.memoryMegabytes;
  const defaultWords =
    officeDefault === undefined
      ? "Office default"
      : `Office default (${gigabytesOf(officeDefault)})`;
  return (
    <div className="test-target-field" role="group" aria-label="Memory per service">
      <span className="test-target-field-label">Memory per service</span>
      {memoryMegabytes === null ? (
        <div className="test-target-memory">
          <span className="test-target-memory-default">{defaultWords}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => change(officeDefault ?? FIRST_OWN_MEMORY_MEGABYTES)}
          >
            Set its own limit
          </Button>
        </div>
      ) : (
        <div className="test-target-memory">
          <Stepper
            label="the memory per service"
            value={memoryMegabytes}
            min={MEMORY_PER_SERVICE_MEGABYTES.min}
            max={MEMORY_PER_SERVICE_MEGABYTES.max}
            step={MEMORY_PER_SERVICE_MEGABYTES.step}
            format={gigabytesOf}
            onChange={change}
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => change(null)}>
            Use the Office default
          </Button>
        </div>
      )}
      <span className="test-target-field-hint">
        The most memory each of its services may use, in place of the Office-wide value in Settings
        › Office limits.
        {ignoredOnTheWorkstation &&
          " Run environment isn't On, so it builds on the workstation, which ignores it."}
      </span>
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

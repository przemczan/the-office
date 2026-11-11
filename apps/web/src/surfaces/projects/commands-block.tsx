import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Project, ProjectCommand, ProjectCommandKind } from "@the-office/contracts";
import { Badge, Button, Dialog, Icon, IconButton, Input, Select } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import {
  addCommand,
  changeCommand,
  changeInstallCommand,
  changeInstallInputs,
  projectQueries,
  removeCommand,
} from "../../api/projects.ts";
import { AskDevopsButton } from "../../shell/ask-devops.tsx";
import {
  COMMAND_KIND_LABELS,
  COMMAND_KINDS,
  INSTALL_INPUTS_LABEL,
  INSTALL_LABEL,
  installInputsLine,
} from "../../shell/project-words.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { installInputsFrom } from "./project-labels.ts";
import { ProjectBlock } from "./project-block.tsx";

const KIND_OPTIONS = COMMAND_KINDS.map((kind) => ({
  value: kind,
  label: COMMAND_KIND_LABELS[kind],
}));

/** What the block edits in place: install's line, the install inputs, a command, or a new one. */
type Editing = "install" | "install-inputs" | { readonly key: string } | "new-command";

/** Install's line or the install inputs, shown as text and changed in place. */
interface LineRow {
  readonly id: "install" | "install-inputs";
  readonly label: string;
  /** The row's pencil, as a screen reader names it. */
  readonly changeLabel: string;
  readonly inputLabel: string;
  readonly placeholder?: string;
  /** The line as the Project keeps it, which the editor starts from. */
  readonly line: string;
  /** What the row shows when `line` is empty. */
  readonly emptyLine: string;
  readonly savedMessage: string;
  isUnchanged(line: string): boolean;
  save(line: string): Promise<Project>;
}

/**
 * The Project's install command and install inputs, then its commands in their order, each changed
 * in place (spec §9: edited directly in tier 1); a command can also be added and removed.
 */
export function CommandsBlock({ project }: { readonly project: Project }): ReactNode {
  const [editing, setEditing] = useState<Editing>();
  const [removing, setRemoving] = useState<ProjectCommand>();
  const done = (): void => setEditing(undefined);
  return (
    <ProjectBlock
      icon="terminal"
      title="Commands"
      actions={
        <AskDevopsButton
          label={(name) => `Ask ${name} to propose a change`}
          draft={`Can you propose a change to the commands of ${project.name}? `}
        />
      }
      note="Script Stages run these in the Task's worktree with no Agent, as they are when the Stage runs. A test command's runs never reach the work."
    >
      <div className="commands">
        {lineRowsOf(project).map((row) =>
          editing === row.id ? (
            <LineEditor key={row.id} row={row} onDone={done} />
          ) : (
            <div key={row.id} className="command-row">
              <span className="command-key">{row.label}</span>
              <CommandLine line={row.line} emptyLine={row.emptyLine} />
              <IconButton
                icon={<Icon name="pencil" size={14} />}
                label={row.changeLabel}
                size="sm"
                onClick={() => setEditing(row.id)}
              />
            </div>
          ),
        )}
        {project.commands.map((command) =>
          typeof editing === "object" && editing.key === command.key ? (
            <CommandEditor key={command.key} project={project} command={command} onDone={done} />
          ) : (
            <CommandRow
              key={command.key}
              command={command}
              onChange={() => setEditing({ key: command.key })}
              onRemove={() => setRemoving(command)}
            />
          ),
        )}
        {editing === "new-command" && <CommandEditor project={project} onDone={done} />}
      </div>
      {editing !== "new-command" && (
        <div className="commands-actions">
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Icon name="plus" size={14} />}
            onClick={() => setEditing("new-command")}
          >
            Add a command
          </Button>
        </div>
      )}
      {removing && (
        <RemoveCommandDialog
          project={project}
          command={removing}
          onClose={() => setRemoving(undefined)}
        />
      )}
    </ProjectBlock>
  );
}

function lineRowsOf(project: Project): LineRow[] {
  return [
    {
      id: "install",
      label: INSTALL_LABEL,
      changeLabel: "Change the install command",
      inputLabel: "Install command",
      line: project.installCommand,
      // Left blank when the Project was added: it can be set here, but once set not cleared.
      emptyLine: "Not set",
      // A running Task reads it before its next Stage, so a change reaches it there (task 24).
      savedMessage: "Install command saved. Tasks install with it before their next Stage.",
      isUnchanged: (line) => line.trim() === project.installCommand,
      save: (line) => changeInstallCommand(project.id, line),
    },
    {
      id: "install-inputs",
      label: INSTALL_INPUTS_LABEL,
      changeLabel: "Change the install inputs",
      inputLabel: INSTALL_INPUTS_LABEL,
      placeholder: "package-lock.json, apps/web/package.json",
      line: installInputsLine(project.installInputs),
      emptyLine: "None: a worktree installs once.",
      savedMessage: "Install inputs saved.",
      isUnchanged: (line) => installInputsFrom(line).join() === project.installInputs.join(),
      save: (line) => changeInstallInputs(project.id, installInputsFrom(line)),
    },
  ];
}

function CommandLine({
  line,
  emptyLine,
}: {
  readonly line: string;
  readonly emptyLine: string;
}): ReactNode {
  return line === "" ? (
    <span className="command-empty">{emptyLine}</span>
  ) : (
    <code className="command-line">{line}</code>
  );
}

function CommandRow({
  command,
  onChange,
  onRemove,
}: {
  readonly command: ProjectCommand;
  readonly onChange: () => void;
  readonly onRemove: () => void;
}): ReactNode {
  return (
    <div className="command-row" aria-label={`The ${command.name} command`} role="group">
      <span className="command-key">{command.name}</span>
      {/* Left blank when the Project was added: it can be set here, but once set not cleared. */}
      <CommandLine line={command.commandLine} emptyLine="Not set" />
      <span className="command-meta">
        <Badge mono size="sm">
          {command.key}
        </Badge>
        <Badge size="sm">{COMMAND_KIND_LABELS[command.kind]}</Badge>
      </span>
      <IconButton
        icon={<Icon name="pencil" size={14} />}
        label={`Change the ${command.name} command`}
        size="sm"
        onClick={onChange}
      />
      <IconButton
        icon={<Icon name="trash-2" size={14} />}
        label={`Remove the ${command.name} command`}
        size="sm"
        onClick={onRemove}
      />
    </div>
  );
}

function useSavedProject(): (saved: Project) => void {
  const queryClient = useQueryClient();
  return (saved) => queryClient.setQueryData(projectQueries.one(saved.id).queryKey, saved);
}

function LineEditor({
  row,
  onDone,
}: {
  readonly row: LineRow;
  readonly onDone: () => void;
}): ReactNode {
  const [line, setLine] = useState(row.line);
  const keep = useSavedProject();
  const showToast = useToast();
  const saving = useMutation({
    mutationFn: (changed: string) => row.save(changed),
    onSuccess: (saved) => {
      keep(saved);
      showToast(row.savedMessage);
      onDone();
    },
  });
  const save = (): void => {
    if (row.isUnchanged(line)) onDone();
    else saving.mutate(line);
  };
  return (
    <form
      className="command-row editing"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <span className="command-key">{row.label}</span>
      <Input
        aria-label={row.inputLabel}
        aria-invalid={saving.isError}
        placeholder={row.placeholder}
        value={line}
        onChange={(event) => setLine(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onDone();
        }}
        autoFocus
        size="sm"
        style={{ flex: 1 }}
        inputStyle={{ fontFamily: "var(--font-mono)" }}
      />
      <EditorButtons pending={saving.isPending} onCancel={onDone} />
      {saving.error && (
        <p className="command-error" role="alert">
          {saving.error.message}
        </p>
      )}
    </form>
  );
}

/**
 * A command's name, kind and command line changed in place, or a new command with its key too: the
 * key is fixed once added, as Pipelines name a command by it.
 */
function CommandEditor({
  project,
  command,
  onDone,
}: {
  readonly project: Project;
  /** Undefined for a new command. */
  readonly command?: ProjectCommand;
  readonly onDone: () => void;
}): ReactNode {
  const [key, setKey] = useState(command?.key ?? "");
  const [name, setName] = useState(command?.name ?? "");
  const [kind, setKind] = useState<ProjectCommandKind>(command?.kind ?? "test");
  const [commandLine, setCommandLine] = useState(command?.commandLine ?? "");
  const keep = useSavedProject();
  const showToast = useToast();
  const saving = useMutation({
    mutationFn: () =>
      command
        ? changeCommand(project.id, command.key, { name, kind, commandLine })
        : addCommand(project.id, { key: key.trim(), name, kind, commandLine }),
    onSuccess: (saved) => {
      keep(saved);
      const shownName = name.trim();
      showToast(
        command
          ? `${shownName} saved. Tasks run it as saved from their next Stage that runs it.`
          : `${shownName} added.`,
      );
      onDone();
    },
  });
  const unchanged =
    command !== undefined &&
    name.trim() === command.name &&
    kind === command.kind &&
    commandLine.trim() === command.commandLine;
  const cancelOnEscape = (event: { readonly key: string }): void => {
    if (event.key === "Escape") onDone();
  };
  return (
    <form
      className="command-editor"
      aria-label={command ? `Change the ${command.name} command` : "Add a command"}
      onSubmit={(event) => {
        event.preventDefault();
        if (unchanged) onDone();
        else saving.mutate();
      }}
    >
      {saving.error && (
        <RefusalAlert
          title={command ? "The command wasn't saved" : "The command wasn't added"}
          error={saving.error}
        />
      )}
      <div className="command-editor-fields">
        {command ? (
          <span className="command-editor-key">
            Key{" "}
            <Badge mono size="sm">
              {command.key}
            </Badge>
          </span>
        ) : (
          <Input
            label="Key"
            hint='Lower-case letters, digits and "-"; fixed once added.'
            placeholder="test-e2e"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            onKeyDown={cancelOnEscape}
            autoFocus
            size="sm"
            inputStyle={{ fontFamily: "var(--font-mono)" }}
          />
        )}
        <Input
          label="Name"
          placeholder="End-to-end tests"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={cancelOnEscape}
          autoFocus={command !== undefined}
          size="sm"
        />
        <Select
          label="Kind"
          hint="A test command's runs never reach the work."
          options={KIND_OPTIONS}
          value={kind}
          onChange={(value) => setKind(value as ProjectCommandKind)}
          size="sm"
        />
      </div>
      <Input
        label="Command line"
        placeholder="npm run test:e2e"
        value={commandLine}
        onChange={(event) => setCommandLine(event.target.value)}
        onKeyDown={cancelOnEscape}
        size="sm"
        inputStyle={{ fontFamily: "var(--font-mono)" }}
      />
      <div className="command-editor-actions">
        <EditorButtons
          pending={saving.isPending}
          submitLabel={command ? "Save" : "Add"}
          onCancel={onDone}
        />
      </div>
    </form>
  );
}

function EditorButtons({
  pending,
  submitLabel = "Save",
  onCancel,
}: {
  readonly pending: boolean;
  readonly submitLabel?: string;
  readonly onCancel: () => void;
}): ReactNode {
  return (
    <>
      <Button type="submit" variant="primary" size="sm" loading={pending}>
        {submitLabel}
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </>
  );
}

/** A confirmation (spec 4.1: a small window), as a Pipeline that names the key no longer finds it. */
function RemoveCommandDialog({
  project,
  command,
  onClose,
}: {
  readonly project: Project;
  readonly command: ProjectCommand;
  readonly onClose: () => void;
}): ReactNode {
  const keep = useSavedProject();
  const showToast = useToast();
  const removing = useMutation({
    mutationFn: () => removeCommand(project.id, command.key),
    onSuccess: (saved) => {
      keep(saved);
      showToast(`${command.name} removed.`);
      onClose();
    },
  });
  return (
    <Dialog
      size="small"
      title={`Remove ${command.name}?`}
      onClose={onClose}
      actions={
        <Button variant="danger" loading={removing.isPending} onClick={() => removing.mutate()}>
          Remove
        </Button>
      }
    >
      <div className="dialog-stack">
        {removing.error && <RefusalAlert title="Nothing was removed" error={removing.error} />}
        <p className="dialog-text">
          The command <code>{command.key}</code> is removed from {project.name}. A Stage that runs
          it can't run it any more.
        </p>
      </div>
    </Dialog>
  );
}

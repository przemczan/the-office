import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Project } from "@the-office/contracts";
import { Button, Icon, IconButton, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { changeCommand, changeInstallInputs, projectQueries } from "../../api/projects.ts";
import { AskDevopsButton } from "../../shell/ask-devops.tsx";
import {
  COMMAND_KEYS,
  COMMAND_LABELS,
  INSTALL_INPUTS_LABEL,
  installInputsLine,
} from "../../shell/project-words.ts";
import { useToast } from "../../shell/toasts.tsx";
import { installInputsFrom } from "./project-labels.ts";
import { ProjectBlock } from "./project-block.tsx";

const COMMAND_SAVED = "Command saved. Running Tasks keep the one they started with.";

/** One line of the block, shown as text and changed in place. */
interface CommandsRow {
  readonly id: string;
  readonly label: string;
  /** The row's pencil, as a screen reader names it. */
  readonly changeLabel: string;
  readonly inputLabel: string;
  readonly placeholder?: string;
  /** The line as the Project keeps it, which the editor starts from. */
  readonly line: string;
  /** What the row shows when `line` is empty. */
  readonly emptyLine?: string;
  readonly savedMessage: string;
  isUnchanged(line: string): boolean;
  save(line: string): Promise<Project>;
}

/**
 * The Project's commands, each changed in place (spec §9: edited directly in tier 1), with the
 * install inputs beside the install command.
 */
export function CommandsBlock({ project }: { readonly project: Project }): ReactNode {
  const [editing, setEditing] = useState<string>();
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
      note="Script Stages run these in the Task's worktree with no Agent. Running Tasks keep the command they started with."
    >
      <div className="commands">
        {rowsOf(project).map((row) =>
          row.id === editing ? (
            <RowEditor key={row.id} row={row} onDone={() => setEditing(undefined)} />
          ) : (
            <div key={row.id} className="command-row">
              <span className="command-key">{row.label}</span>
              {row.line === "" ? (
                <span className="command-empty">{row.emptyLine}</span>
              ) : (
                <code className="command-line">{row.line}</code>
              )}
              <IconButton
                icon={<Icon name="pencil" size={14} />}
                label={row.changeLabel}
                size="sm"
                onClick={() => setEditing(row.id)}
              />
            </div>
          ),
        )}
      </div>
    </ProjectBlock>
  );
}

function rowsOf(project: Project): CommandsRow[] {
  return COMMAND_KEYS.flatMap((key): CommandsRow[] => {
    const command: CommandsRow = {
      id: key,
      label: COMMAND_LABELS[key],
      changeLabel: `Change the ${COMMAND_LABELS[key].toLowerCase()} command`,
      inputLabel: `${COMMAND_LABELS[key]} command`,
      line: project.commands[key],
      savedMessage: COMMAND_SAVED,
      isUnchanged: (line) => line.trim() === project.commands[key],
      save: (line) => changeCommand(project.id, key, line),
    };
    if (key !== "install") return [command];
    const installInputs: CommandsRow = {
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
    };
    return [command, installInputs];
  });
}

function RowEditor({
  row,
  onDone,
}: {
  readonly row: CommandsRow;
  readonly onDone: () => void;
}): ReactNode {
  const [line, setLine] = useState(row.line);
  const queryClient = useQueryClient();
  const showToast = useToast();
  const saving = useMutation({
    mutationFn: (changed: string) => row.save(changed),
    onSuccess: (saved) => {
      queryClient.setQueryData(projectQueries.one(saved.id).queryKey, saved);
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
      <Button type="submit" variant="primary" size="sm" loading={saving.isPending}>
        Save
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={onDone}>
        Cancel
      </Button>
      {saving.error && (
        <p className="command-error" role="alert">
          {saving.error.message}
        </p>
      )}
    </form>
  );
}

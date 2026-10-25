import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Project, ProjectCommandKey } from "@the-office/contracts";
import { Button, Icon, IconButton, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { changeCommand, projectQueries } from "../../api/projects.ts";
import { useToast } from "../../shell/toasts.tsx";
import { COMMAND_KEYS, COMMAND_LABELS } from "./project-labels.ts";
import { ProjectBlock } from "./project-block.tsx";

/** The Project's commands, each changed in place (spec §9: edited directly in tier 1). */
export function CommandsBlock({ project }: { readonly project: Project }): ReactNode {
  const [editing, setEditing] = useState<ProjectCommandKey>();
  return (
    <ProjectBlock
      icon="terminal"
      title="Commands"
      note="Script Stages run these in the Task's worktree with no Agent. Running Tasks keep the command they started with."
    >
      <div className="commands">
        {COMMAND_KEYS.map((key) =>
          key === editing ? (
            <CommandEditor
              key={key}
              project={project}
              commandKey={key}
              onDone={() => setEditing(undefined)}
            />
          ) : (
            <div key={key} className="command-row">
              <span className="command-key">{COMMAND_LABELS[key]}</span>
              <code className="command-line">{project.commands[key]}</code>
              <IconButton
                icon={<Icon name="pencil" size={14} />}
                label={`Change the ${COMMAND_LABELS[key].toLowerCase()} command`}
                size="sm"
                onClick={() => setEditing(key)}
              />
            </div>
          ),
        )}
      </div>
    </ProjectBlock>
  );
}

function CommandEditor({
  project,
  commandKey,
  onDone,
}: {
  readonly project: Project;
  readonly commandKey: ProjectCommandKey;
  readonly onDone: () => void;
}): ReactNode {
  const [commandLine, setCommandLine] = useState(project.commands[commandKey]);
  const queryClient = useQueryClient();
  const showToast = useToast();
  const saving = useMutation({
    mutationFn: (line: string) => changeCommand(project.id, commandKey, line),
    onSuccess: (saved) => {
      queryClient.setQueryData(projectQueries.one(saved.id).queryKey, saved);
      showToast("Command saved. Running Tasks keep the one they started with.");
      onDone();
    },
  });
  const save = (): void => {
    if (commandLine.trim() === project.commands[commandKey]) onDone();
    else saving.mutate(commandLine);
  };
  const label = COMMAND_LABELS[commandKey];
  return (
    <form
      className="command-row editing"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <span className="command-key">{label}</span>
      <Input
        aria-label={`${label} command`}
        aria-invalid={saving.isError}
        value={commandLine}
        onChange={(event) => setCommandLine(event.target.value)}
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

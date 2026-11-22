import type { Project, TestTargetSetter } from "@the-office/contracts";
import { Icon, IconButton, Select } from "@the-office/ui";
import type { ReactNode } from "react";
import { useSignedInUserId } from "../../shell/use-user-name.ts";
import {
  movedBy,
  notACommandWords,
  runnableCommandsOf,
  setByWords,
  unknownCommandKeys,
} from "./test-target-words.ts";

/**
 * The Project's commands run in the checkout before something, in order, as a test target's
 * Commands before the entry point and a Project command Action's Commands before it: each can be
 * moved or removed, and one the Project no longer has is flagged.
 */
export function CommandsBeforeField({
  project,
  label,
  hint,
  commandsBefore,
  change,
}: {
  readonly project: Project;
  /** The field's name, such as "Commands before the entry point". */
  readonly label: string;
  /** Under Add a command: where and when they run. */
  readonly hint: string;
  readonly commandsBefore: readonly string[];
  readonly change: (commandsBefore: readonly string[]) => void;
}): ReactNode {
  const runnable = runnableCommandsOf(project);
  const addable = runnable.filter(({ key }) => !commandsBefore.includes(key));
  const unknown = unknownCommandKeys(commandsBefore, runnable);
  return (
    <div className="test-target-field" role="group" aria-label={label}>
      <span className="test-target-field-label">{label}</span>
      {commandsBefore.length > 0 && (
        <ol className="test-target-commands" aria-label={`${label}, in order`}>
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
          hint={hint}
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
 * A field with who set it last beside it, when anyone is known: a test target's or an Action's
 * value, whose setters have the same shape.
 */
export function Marked({
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

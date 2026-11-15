import { officeCommandClash, type SkillCommand } from "@the-office/contracts";
import { Icon, IconButton } from "@the-office/ui";
import type { ReactNode } from "react";
import { COMMAND_KIND_WORDS, commandChoices, officeCommandClashWords } from "./command-words.ts";
import "../conversation/conversation.css";
import "../mentions/mentions.css";
import "./commands.css";

/**
 * What an Office command answers above the composer: /help's list, or why /clear did nothing. It
 * isn't logged; it closes with Esc in the message box, its ×, or the next message sent.
 */
export function CommandNote({
  children,
  label,
  onClose,
}: {
  readonly children: ReactNode;
  readonly label: string;
  readonly onClose: () => void;
}): ReactNode {
  return (
    <div className="composer-note command-note" role="note" aria-label={label}>
      <Icon name="square-slash" size={14} />
      <div className="composer-note-text">{children}</div>
      <IconButton
        icon={<Icon name="x" size={14} />}
        label="Close"
        variant="ghost"
        size="sm"
        onClick={onClose}
      />
    </div>
  );
}

/** /help: the Office commands, then the Thread's skill commands, each with what it does. */
export function CommandHelp({
  skillCommands,
}: {
  readonly skillCommands: readonly SkillCommand[];
}): ReactNode {
  return (
    <>
      Commands you can use here:
      <dl className="command-help-list">
        {commandChoices(skillCommands).map((command) => (
          <div key={`${command.kind}:${command.name}`} className="command-help-row">
            <dt className="command-help-name">/{command.name}</dt>
            <dd>{command.description}</dd>
            <dd className="mention-picker-kind">{COMMAND_KIND_WORDS[command.kind]}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/**
 * Where a skill is assigned: a skill named like an Office command can still be assigned, but never
 * runs as a skill command. Nothing for any other skill.
 */
export function SkillCommandClash({ skillName }: { readonly skillName: string }): ReactNode {
  if (!officeCommandClash(skillName)) return null;
  return (
    <span className="skill-command-clash" role="note">
      <Icon name="triangle-alert" size={14} />
      {officeCommandClashWords(skillName)}
    </span>
  );
}

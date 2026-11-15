import type { SkillCommand } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  COMMAND_KIND_WORDS,
  commandQueryOf,
  matchingCommands,
  type CommandChoice,
} from "./command-words.ts";
import "../mentions/mentions.css";
import "./commands.css";

/** What a message field wires in to offer commands, and the "/" list it shows by it. */
export interface Commands {
  readonly onKeyDownFirst: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  readonly picker: ReactNode;
}

/**
 * The "/" list (spec §2.4): while the draft starts with "/" and has no whitespace yet, it lists the
 * Office commands, then the Thread's skill commands, whose names start with what is typed. Arrows
 * move, Enter or Tab completes the command, Esc closes. Enter on a name typed whole leaves the key to
 * the field, so it sends. Without `skillCommands`, as in a Stage Thread, "/" is ordinary text.
 */
export function useCommands(
  draft: string,
  setDraft: (draft: string) => void,
  skillCommands: readonly SkillCommand[] | undefined,
): Commands {
  const query = skillCommands === undefined ? undefined : commandQueryOf(draft);
  const [closedFor, setClosedFor] = useState<string>();
  const [picked, setPicked] = useState({ query: "", index: 0 });
  const open = query !== undefined && closedFor !== draft;
  const shown = open ? matchingCommands(skillCommands ?? [], query) : [];
  const index = picked.query === query ? Math.min(picked.index, shown.length - 1) : 0;

  const complete = (command: CommandChoice | undefined): void => {
    if (command !== undefined) setDraft(`/${command.name} `);
  };

  const onKeyDownFirst = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (shown.length === 0 || query === undefined || event.nativeEvent.isComposing) return false;
    const move = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (move !== undefined) {
      setPicked({ query, index: (index + move + shown.length) % shown.length });
    } else if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
      const command = shown[index];
      if (event.key === "Enter" && command?.name === query) return false;
      complete(command);
    } else if (event.key === "Escape") {
      // The list is the innermost thing open: Esc closes it, not the chat around it.
      event.stopPropagation();
      setClosedFor(draft);
    } else {
      return false;
    }
    event.preventDefault();
    return true;
  };

  return {
    onKeyDownFirst,
    picker: shown.length > 0 && <CommandPicker shown={shown} index={index} onPick={complete} />,
  };
}

function CommandPicker({
  shown,
  index,
  onPick,
}: {
  readonly shown: readonly CommandChoice[];
  readonly index: number;
  readonly onPick: (command: CommandChoice) => void;
}): ReactNode {
  const id = useId();
  return (
    <div className="mention-picker command-picker">
      <p className="mention-picker-title" id={id}>
        Commands
      </p>
      <ul role="listbox" aria-labelledby={id}>
        {shown.map((command, at) => (
          <li
            key={`${command.kind}:${command.name}`}
            role="option"
            aria-selected={at === index}
            className={at === index ? "on" : undefined}
            // mousedown, not click: the field keeps its focus while a command is picked.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(command);
            }}
          >
            <Icon name={command.kind === "office" ? "slash" : "sparkles"} size={14} />
            <span className="command-picker-words">
              <span className="command-picker-name">/{command.name}</span>
              <span className="command-picker-description">{command.description}</span>
            </span>
            <span className="mention-picker-kind">{COMMAND_KIND_WORDS[command.kind]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

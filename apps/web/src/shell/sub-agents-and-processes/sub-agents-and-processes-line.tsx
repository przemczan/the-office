import { useQuery } from "@tanstack/react-query";
import type { Thread } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { lineText, lineWords, whereWords } from "./sub-agents-and-processes-words.ts";
import { SubAgentsAndProcessesWindow } from "./sub-agents-and-processes-window.tsx";
import { useSubAgentsAndProcesses } from "./use-sub-agents-and-processes.ts";
import "./sub-agents-and-processes.css";

/**
 * Above a Thread's message input, or the note saying why it takes none: how many Sub-agents and
 * Processes its session runs and has ended, once it has had any (spec 2.9). Neutral, as it tells
 * and asks nothing; the whole line is one button, which opens the view's window, or does what the
 * place gives instead (the Stage history, already a window, switches to the run's tab).
 */
export function SubAgentsAndProcessesLine({
  thread,
  personName,
  onShow,
}: {
  readonly thread: Thread;
  readonly personName: string;
  readonly onShow?: (() => void) | undefined;
}): ReactNode {
  const items = useSubAgentsAndProcesses(thread.id);
  const [open, setOpen] = useState(false);
  const words = items && lineWords(items);
  if (words === undefined) return null;
  return (
    <>
      <button
        type="button"
        className="sub-agents-and-processes-line"
        aria-label={`${lineText(words)}. Show them.`}
        {...(onShow === undefined && { "aria-haspopup": "dialog", "aria-expanded": open })}
        onClick={onShow ?? (() => setOpen(true))}
      >
        <span className="sub-agents-and-processes-line-mark" aria-hidden="true">
          {words.live ? <span className="live-dot" /> : <Icon name="bot" size={14} />}
        </span>
        <span className="sub-agents-and-processes-line-text" aria-hidden="true">
          {words.pieces.map(({ text, look }) =>
            look === undefined ? (
              text
            ) : (
              // Each look comes once.
              <span key={look} className={look}>
                {text}
              </span>
            ),
          )}
        </span>
        <span className="sub-agents-and-processes-line-show" aria-hidden="true">
          <span className="sub-agents-and-processes-line-show-words">Show</span>
          <Icon name="chevron-right" size={12} />
        </span>
      </button>
      {open && (
        <SubAgentsAndProcessesWindow
          threadId={thread.id}
          personName={personName}
          where={whereWords(thread, personName)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** The line of a Thread known by its id alone, as a read-only note's place has it. */
export function SubAgentsAndProcessesLineOf({
  threadId,
  personName,
}: {
  readonly threadId: string;
  readonly personName: string;
}): ReactNode {
  const thread = useQuery(threadQueries.one(threadId)).data;
  return thread && <SubAgentsAndProcessesLine thread={thread} personName={personName} />;
}

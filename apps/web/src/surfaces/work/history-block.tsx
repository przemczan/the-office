import { useQuery } from "@tanstack/react-query";
import type { History } from "@the-office/contracts";
import { Alert, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { ideaQueries, initiativeQueries, taskQueries } from "../../api/work.ts";
import { dayAndClockOf } from "../../shell/time.ts";
import { historyEntryWords, historySummary } from "./history-words.ts";
import { RecordFold } from "./record-fold.tsx";
import { useFold } from "./record-folds.ts";

/** A record's History, oldest first: a line per move between states or edit, with its time. */
export function HistoryList({ history }: { readonly history: History }): ReactNode {
  if (history.length === 0) return <p className="task-quiet">Nothing has changed yet.</p>;
  return (
    <ol className="record-history" aria-label="History">
      {history.map((entry, index) => (
        <li key={`${entry.at}-${index}`} className="task-plan">
          {historyEntryWords(entry)}{" "}
          <time className="task-quiet" dateTime={entry.at}>
            · {dayAndClockOf(entry.at)}
          </time>
        </li>
      ))}
    </ol>
  );
}

function HistoryContent({
  history,
  error,
}: {
  readonly history: History | undefined;
  readonly error: Error | null;
}): ReactNode {
  if (error)
    return (
      <Alert tone="danger" title="The History wasn't read">
        {error.message}
      </Alert>
    );
  if (history === undefined) return <p className="task-quiet">Reading…</p>;
  return <HistoryList history={history} />;
}

/** The History as a fold of a Task's Overview or an Initiative's record, folded at first. */
export function HistoryBlock({
  record,
}: {
  readonly record: { readonly kind: "task" | "initiative"; readonly id: string };
}): ReactNode {
  const fold = useFold(record, "history", false);
  const history = useQuery(
    record.kind === "task" ? taskQueries.history(record.id) : initiativeQueries.history(record.id),
  );
  return (
    <RecordFold fold={fold} icon="history" title="History" summary={historySummary(history.data)}>
      <HistoryContent history={history.data} error={history.error} />
    </RecordFold>
  );
}

/** An Idea card's History, read only once it is unfolded. */
export function IdeaHistory({ ideaId }: { readonly ideaId: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const history = useQuery({ ...ideaQueries.history(ideaId), enabled: open });
  return (
    <details className="idea-card-history" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <Icon name="history" size={13} />
        History
      </summary>
      {open && <HistoryContent history={history.data} error={history.error} />}
    </details>
  );
}

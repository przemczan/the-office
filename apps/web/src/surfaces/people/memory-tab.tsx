import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import type { MemoryNote, Task } from "@the-office/contracts";
import { Alert, Button, Dialog, Select, Textarea } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { addMemoryNote, clearMemory, deleteMemoryNote, roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { taskQueries } from "../../api/work.ts";
import { useChat } from "../../shell/chat/use-chat.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { dayAndClockOf } from "../../shell/time.ts";
import { useToast } from "../../shell/toasts.tsx";
import { useUserName } from "../../shell/use-user-name.ts";
import { ALL_PROJECTS, memoryGroups } from "./memory-groups.ts";
import { PersonBlock } from "./role-card-layout.tsx";

/**
 * The person's Memory: small notes, newest first under the Project they are about. The user adds
 * a note and deletes one or all, but never edits a note: the memory is append-only.
 */
export function MemoryTab(): ReactNode {
  const { roleKey } = useParams({ from: "/people/$roleKey/memory" });
  const role = useQuery(roleQueries.one(roleKey));
  const memory = useQuery(roleQueries.memory(roleKey));
  const projects = useQuery(projectQueries.list());
  const tasks = useQuery(taskQueries.list());
  const [deleting, setDeleting] = useState<MemoryNote | "all">();
  if (!role.data || !memory.data || !projects.data) return null;
  const { name } = role.data.card;
  const { inUse, notes } = memory.data;
  const groups = memoryGroups(notes, projects.data);
  return (
    <div className="person-columns">
      <div className="person-column">
        <PersonBlock
          icon="brain"
          title={`Memory · ${notes.length}`}
          actions={
            notes.length > 0 && (
              <Button size="sm" variant="secondary" onClick={() => setDeleting("all")}>
                Delete memory
              </Button>
            )
          }
        >
          {!inUse && (
            <Alert tone="warning" title="Not in use">
              Shared memory is off for {name}: the notes are kept, but no session reads them and
              nothing new is written. Turn it on on the Role card to bring them back.
            </Alert>
          )}
          <p className="person-note">
            Every new session of {name} reads these at start. Notes are appended, never edited.
          </p>
          {groups.length === 0 && <p className="person-note">No notes yet.</p>}
          {groups.map(({ projectId, title, notes: grouped }) => (
            <section key={projectId ?? ALL_PROJECTS} className="memory-group">
              <h4 className="memory-group-title">{title}</h4>
              <ul className="memory-notes">
                {grouped.map((note) => (
                  <li key={note.id} className="memory-note">
                    <p className="memory-note-text">{note.text}</p>
                    <div className="memory-note-meta">
                      <span>{dayAndClockOf(note.writtenAt)}</span>
                      <NoteSource
                        roleKey={roleKey}
                        note={note}
                        personName={name}
                        tasks={tasks.data}
                      />
                      <Button size="sm" variant="secondary" onClick={() => setDeleting(note)}>
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </PersonBlock>
      </div>
      <div className="person-column">{inUse && <AddNote roleKey={roleKey} />}</div>
      {deleting === "all" && (
        <DeleteMemoryDialog
          roleKey={roleKey}
          count={notes.length}
          onClose={() => setDeleting(undefined)}
        />
      )}
      {deleting && deleting !== "all" && (
        <DeleteNoteDialog
          roleKey={roleKey}
          note={deleting}
          onClose={() => setDeleting(undefined)}
        />
      )}
    </div>
  );
}

function NoteSource({
  roleKey,
  note,
  personName,
  tasks,
}: {
  readonly roleKey: string;
  readonly note: MemoryNote;
  readonly personName: string;
  readonly tasks: readonly Task[] | undefined;
}): ReactNode {
  const chat = useChat();
  const nameOfUser = useUserName();
  const { source } = note;
  if (source.kind === "user") return <span>Added by {nameOfUser(source.user, "you")}</span>;
  if (source.taskId === undefined) {
    return (
      <button
        type="button"
        className="memory-note-link"
        onClick={() => chat.open(roleKey, source.threadId)}
      >
        Written by {personName} in a chat
      </button>
    );
  }
  const task = tasks?.find(({ id }) => id === source.taskId);
  return (
    <Link
      to="/tasks/$taskId"
      params={{ taskId: source.taskId }}
      search={{ taskThread: source.threadId }}
      className="memory-note-link"
    >
      Written by {personName} on {task ? task.title : "a Task"}
    </Link>
  );
}

/** The radio value for a note that holds for all Projects. */
const ALL = "";

function AddNote({ roleKey }: { readonly roleKey: string }): ReactNode {
  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState(ALL);
  const projects = useQuery(projectQueries.list());
  const queryClient = useQueryClient();
  const adding = useMutation({
    mutationFn: (note: string) =>
      addMemoryNote(roleKey, { text: note, projectId: projectId || undefined }),
    onSuccess: async (_added, note) => {
      // The next note may be typed already, the added one showing from its event before this answer.
      setText((current) => (current === note ? "" : current));
      await queryClient.invalidateQueries(roleQueries.memory(roleKey));
    },
  });
  return (
    <PersonBlock icon="plus" title="Add a note">
      <form
        className="memory-add"
        onSubmit={(event) => {
          event.preventDefault();
          adding.mutate(text);
        }}
      >
        {adding.error && <RefusalAlert title="The note can't be added" error={adding.error} />}
        <Textarea
          label="Note"
          hint="Short and standing on its own: it is read in a later session, never edited."
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <Select
          label="About"
          value={projectId}
          options={[
            { value: ALL, label: ALL_PROJECTS },
            ...(projects.data ?? []).map(({ id, name }) => ({ value: id, label: name })),
          ]}
          onChange={setProjectId}
        />
        <Button type="submit" loading={adding.isPending} disabled={text.trim() === ""}>
          Add note
        </Button>
      </form>
    </PersonBlock>
  );
}

function DeleteNoteDialog({
  roleKey,
  note,
  onClose,
}: {
  readonly roleKey: string;
  readonly note: MemoryNote;
  readonly onClose: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const deleting = useMutation({
    mutationFn: () => deleteMemoryNote(roleKey, note.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries(roleQueries.memory(roleKey));
      showToast("Note deleted.");
      onClose();
    },
  });
  return (
    <ConfirmDeleteDialog
      title="Delete this note?"
      action="Delete the note"
      pending={deleting.isPending}
      error={deleting.error}
      onConfirm={() => deleting.mutate()}
      onClose={onClose}
    >
      <p className="dialog-text">
        “{note.text}” is removed from the memory. Sessions started after this don't read it.
      </p>
    </ConfirmDeleteDialog>
  );
}

function DeleteMemoryDialog({
  roleKey,
  count,
  onClose,
}: {
  readonly roleKey: string;
  readonly count: number;
  readonly onClose: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const deleting = useMutation({
    mutationFn: () => clearMemory(roleKey),
    onSuccess: async () => {
      await queryClient.invalidateQueries(roleQueries.memory(roleKey));
      showToast("Memory deleted.");
      onClose();
    },
  });
  return (
    <ConfirmDeleteDialog
      title="Delete the whole memory?"
      action="Delete memory"
      pending={deleting.isPending}
      error={deleting.error}
      onConfirm={() => deleting.mutate()}
      onClose={onClose}
    >
      <p className="dialog-text">
        All {count} {count === 1 ? "note" : "notes"} are removed. This can't be undone.
      </p>
    </ConfirmDeleteDialog>
  );
}

function ConfirmDeleteDialog({
  title,
  action,
  pending,
  error,
  onConfirm,
  onClose,
  children,
}: {
  readonly title: string;
  readonly action: string;
  readonly pending: boolean;
  readonly error: Error | null;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Dialog
      size="small"
      title={title}
      onClose={onClose}
      actions={
        <Button variant="danger" loading={pending} onClick={onConfirm}>
          {action}
        </Button>
      }
    >
      <div className="dialog-stack">
        {error && <RefusalAlert title="Nothing was deleted" error={error} />}
        {children}
      </div>
    </Dialog>
  );
}

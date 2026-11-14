import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Initiative, Project, Task } from "@the-office/contracts";
import { Button, Dialog, Icon, Input, RadioGroup, SearchableSelect } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import {
  addToInitiative,
  initiativeQueries,
  takeOutOfInitiative,
  taskQueries,
} from "../../api/work.ts";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { TASK_STATE_NAMES } from "../../shell/work/work-words.ts";
import { InitiativeStateBadge } from "./initiative-parts.tsx";
import {
  canBeTakenOut,
  canJoinAnInitiative,
  initiativesToJoin,
  joiningWords,
  takingOutWords,
} from "./initiative-membership-words.ts";

/** A Task joining or leaving an Initiative: the answer replaces the shown Task at once. */
function useMembershipChange(
  change: (task: Task) => Promise<Task>,
  onChanged: (changed: Task) => void,
): UseMutationResult<Task, Error, Task> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: change,
    onSuccess: (changed) => {
      queryClient.setQueryData(taskQueries.one(changed.id).queryKey, changed);
      onChanged(changed);
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries(taskQueries.list()),
        queryClient.invalidateQueries(initiativeQueries.list()),
      ]),
  });
}

/**
 * The Initiative the Task is in, with Take out, or Add to an Initiative for a Task in none, as a
 * section of the Description block. Both until the Task starts, and never for a Task The Office
 * made; once it can't change, the section shows only the Initiative it is in.
 */
export function TaskInitiativeSection({ task }: { readonly task: Task }): ReactNode {
  const initiative = useQuery({
    ...initiativeQueries.one(task.initiativeId ?? ""),
    enabled: task.initiativeId !== null,
  }).data;
  const [dialog, setDialog] = useState<"join" | "take-out">();
  const canJoin = canJoinAnInitiative(task);
  if (task.initiativeId === null && !canJoin) return null;
  return (
    <section className="task-record-section" aria-label="Initiative">
      <div className="task-record-section-head">
        <h3 className="task-record-section-title">Initiative</h3>
        {canJoin && (
          <Button size="sm" variant="secondary" onClick={() => setDialog("join")}>
            Add to an Initiative
          </Button>
        )}
        {initiative && canBeTakenOut(task) && (
          <Button size="sm" variant="secondary" onClick={() => setDialog("take-out")}>
            Take out
          </Button>
        )}
      </div>
      {initiative ? (
        <p className="task-plan">
          <Link to="/work/initiatives/$initiativeId" params={{ initiativeId: initiative.id }}>
            {initiative.name}
          </Link>{" "}
          <InitiativeStateBadge initiative={initiative} shaper={undefined} />
        </p>
      ) : (
        task.initiativeId === null && (
          <p className="task-quiet">
            In no Initiative. Add it to one being shaped or active, before it starts.
          </p>
        )
      )}
      {dialog === "join" && (
        <JoinInitiativeDialog task={task} onClose={() => setDialog(undefined)} />
      )}
      {dialog === "take-out" && initiative && (
        <TakeOutDialog
          initiative={initiative}
          candidates={[task]}
          projects={undefined}
          onClose={() => setDialog(undefined)}
        />
      )}
    </section>
  );
}

/** A Shaping or active Initiative for the Task to join, searched as the board's filter is. */
function JoinInitiativeDialog({
  task,
  onClose,
}: {
  readonly task: Task;
  readonly onClose: () => void;
}): ReactNode {
  const showToast = useToast();
  const initiatives = initiativesToJoin(task, useQuery(initiativeQueries.list()).data ?? []);
  const [chosen, setChosen] = useState("");
  const initiative = initiatives.find(({ id }) => id === chosen);
  const joining = useMembershipChange(
    (each) => addToInitiative(chosen, each.id),
    (changed) => {
      showToast(`${changed.title} is in ${initiative?.name ?? "the Initiative"} now.`);
      onClose();
    },
  );
  return (
    <Dialog
      size="medium"
      title="Add to an Initiative"
      onClose={onClose}
      actions={
        <>
          <Button
            loading={joining.isPending}
            disabled={initiative === undefined}
            onClick={() => joining.mutate(task)}
          >
            Add to the Initiative
          </Button>
          {initiative && <span className="dialog-hint">{joiningWords(task, initiative)}</span>}
        </>
      }
    >
      <div className="dialog-stack">
        <p className="dialog-text">
          {task.title} becomes one of the Initiative's Tasks. A Task is in at most one Initiative.
        </p>
        {joining.error && (
          <RefusalAlert title="It can't join that Initiative" error={joining.error} />
        )}
        {initiatives.length === 0 ? (
          <p className="task-quiet">
            No Initiative can take it: none is active
            {task.state === "backlog" ? " or being shaped" : ""}.
          </p>
        ) : (
          <SearchableSelect
            label="Initiative"
            placeholder="Find an Initiative"
            value={chosen}
            options={initiatives.map(({ id, name }) => ({ value: id, label: name }))}
            clearLabel="Clear the Initiative"
            noMatches="No Initiative matches"
            onChange={setChosen}
          />
        )}
      </div>
    </Dialog>
  );
}

/**
 * Takes one of `candidates` out of the Initiative, saying first what happens to its state: a
 * confirmation for one Task, a choice among several.
 */
export function TakeOutDialog({
  initiative,
  candidates,
  projects,
  onClose,
}: {
  readonly initiative: Initiative;
  readonly candidates: readonly Task[];
  readonly projects: readonly Project[] | undefined;
  readonly onClose: () => void;
}): ReactNode {
  const showToast = useToast();
  const [only] = candidates.length === 1 ? candidates : [];
  const [chosen, setChosen] = useState(only?.id);
  const task = candidates.find(({ id }) => id === chosen);
  const takingOut = useMembershipChange(
    (each) => takeOutOfInitiative(initiative.id, each.id),
    (changed) => {
      showToast(
        `${changed.title} is out of ${initiative.name}, in ${TASK_STATE_NAMES[changed.state]}.`,
      );
      onClose();
    },
  );
  return (
    <Dialog
      size={only ? "small" : "medium"}
      title={only ? `Take ${only.title} out of ${initiative.name}?` : "Take a Task out"}
      onClose={onClose}
      actions={
        <Button
          variant="danger"
          loading={takingOut.isPending}
          disabled={task === undefined}
          onClick={() => {
            if (task) takingOut.mutate(task);
          }}
        >
          Take out
        </Button>
      }
    >
      <div className="dialog-stack">
        {takingOut.error && <RefusalAlert title="It can't be taken out" error={takingOut.error} />}
        {!only && (
          <RadioGroup
            options={candidates.map((candidate) => ({
              value: candidate.id,
              label: <TaskLabel task={candidate} projects={projects} />,
            }))}
            value={chosen}
            onChange={setChosen}
          />
        )}
        {task ? (
          <p className="dialog-text">
            {only ? "" : `${task.title} leaves ${initiative.name}. `}
            {takingOutWords(task)}
          </p>
        ) : (
          <p className="task-quiet">
            Choose the Task to take out. Only a Task that hasn't started can leave.
          </p>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Adds one of `candidates`, Tasks in no Initiative, to the Initiative, found by its title, saying
 * what joining does to its state.
 */
export function AddExistingTaskDialog({
  initiative,
  candidates,
  onClose,
}: {
  readonly initiative: Initiative;
  readonly candidates: readonly Task[];
  readonly onClose: () => void;
}): ReactNode {
  const showToast = useToast();
  const projects = useQuery(projectQueries.list()).data;
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<string>();
  const words = search.trim().toLowerCase();
  const found = candidates.filter(({ title }) => title.toLowerCase().includes(words));
  // A choice the search hides is no longer what the user sees chosen.
  const task = found.find(({ id }) => id === chosen);
  const adding = useMembershipChange(
    (each) => addToInitiative(initiative.id, each.id),
    (changed) => {
      showToast(`${changed.title} is in ${initiative.name} now.`);
      onClose();
    },
  );
  return (
    <Dialog
      size="medium"
      title={`Add an existing Task to ${initiative.name}`}
      onClose={onClose}
      actions={
        <>
          <Button
            loading={adding.isPending}
            disabled={task === undefined}
            onClick={() => {
              if (task) adding.mutate(task);
            }}
          >
            Add the Task
          </Button>
          {task && <span className="dialog-hint">{joiningWords(task, initiative)}</span>}
        </>
      }
    >
      <div className="dialog-stack">
        {adding.error && <RefusalAlert title="The Task can't be added" error={adding.error} />}
        {candidates.length === 0 ? (
          <p className="task-quiet">
            No Task can join: each is in an Initiative already, has started, or is one The Office
            made{initiative.state === "shaping" ? ", or isn't in Backlog" : ""}.
          </p>
        ) : (
          <>
            <Input
              aria-label="Find a Task"
              placeholder="Find a Task by its title"
              iconLeft={<Icon name="search" size={14} />}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {found.length === 0 ? (
              <p className="task-quiet">No Task's title has “{search.trim()}”.</p>
            ) : (
              <RadioGroup
                options={found.map((candidate) => ({
                  value: candidate.id,
                  label: <TaskLabel task={candidate} projects={projects} />,
                }))}
                value={task?.id}
                onChange={setChosen}
              />
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function TaskLabel({
  task,
  projects,
}: {
  readonly task: Task;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const project = projects?.find(({ id }) => id === task.projectId);
  return (
    <span className="task-dependencies-option">
      {project && <ProjectMark project={project} />}
      {task.title}
      <span className="task-quiet">· {TASK_STATE_NAMES[task.state]}</span>
    </span>
  );
}

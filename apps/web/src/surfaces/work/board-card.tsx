import type { Project, QueuedTask, Task, TaskState, UsageEstimate } from "@the-office/contracts";
import { Badge, Icon, PlainMark, Popover } from "@the-office/ui";
import { Link } from "@tanstack/react-router";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { counted } from "../../shell/pipelines/stage-change-words.ts";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { KindMark, PriorityIcon } from "../../shell/work/task-state-badge.tsx";
import { useUsageEstimate } from "../../shell/work/usage-estimate-line.tsx";
import { usageEstimateWords } from "../../shell/work/usage-estimate-words.ts";
import { NOT_STARTED, TASK_STATE_TONES, taskStateWords } from "../../shell/work/work-words.ts";
import { useEngineName } from "../../shell/use-engine-name.ts";
import { cardMarks, type CardMark } from "./card-marks.ts";
import { PlanOnCardButton, planningNoteWords } from "./planning-actions.tsx";
import { QueuedCardMark } from "./queue-parts.tsx";
import { TaskMenu } from "./task-menu.tsx";
import { WorkingMark, type PersonWorking } from "./working-mark.tsx";

/** Only the states that need the user's eye colour the edge; the rest keep the normal border. */
const EDGES: Partial<Record<TaskState, string>> = {
  "waiting-on-you": "edge-decision",
  paused: "edge-paused",
  dropped: "edge-failed",
};

export interface BoardCardProps {
  readonly task: Task;
  readonly projects: readonly Project[] | undefined;
  /** The Planner's name; undefined while nobody is the Planner. */
  readonly planner: string | undefined;
  /** In Planning or Paused with a Decision open. */
  readonly waiting: boolean;
  /** Its place in the queue for Start; undefined while it isn't queued. */
  readonly queued: QueuedTask | undefined;
  /** The Tasks it is queued behind for an Overlap. */
  readonly queuedBehind: readonly Task[];
  /** The Tasks still holding it back. */
  readonly blockers: readonly Task[];
  /** The names of the people working on it now. */
  readonly peopleWorking: readonly PersonWorking[];
  /** The current Stage's name while one of them works it. */
  readonly stageName: string | undefined;
  readonly dragging: boolean;
  readonly dropBefore: boolean;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
}

/**
 * A Task on the board (docs/design/task-card-icons.html, Foot row): its title, and under it a row of
 * marks, each an icon whose words show on hover, or, for the blockers and the queue, on a press in a
 * popover with their links. The whole card is the title's link: a press on a mark that only stands
 * for words opens the Task too, and a press on one that is a button never starts a drag.
 */
export function BoardCard({
  task,
  projects,
  planner,
  waiting,
  queued,
  queuedBehind,
  blockers,
  peopleWorking,
  stageName,
  dragging,
  dropBefore,
  onDragStart,
  onDragEnd,
}: BoardCardProps): ReactNode {
  const project = projects?.find(({ id }) => id === task.projectId);
  const movable = NOT_STARTED.includes(task.state) && !queued;
  // Only Ready Tasks, queued ones too, have one.
  const usageEstimate = useUsageEstimate(task.id);
  const titleLink = useRef<HTMLAnchorElement>(null);
  const markPressed = useMarkPressed();
  const marks = cardMarks({
    state: task.state,
    waiting,
    blockers: blockers.length,
    queued: queued !== undefined,
    hasUsageEstimate: usageEstimate !== undefined,
    someoneWorking: peopleWorking.length > 0,
    hasPlanner: planner !== undefined,
  });
  const classes = [
    "board-card",
    waiting ? "edge-decision" : EDGES[task.state],
    dragging && "dragging",
    dropBefore && "drop-before",
  ].filter(Boolean);

  /** A mark that only stands for words opens the Task, as the rest of the card does. */
  const openFromPlainMark = (event: MouseEvent<HTMLDivElement>): void => {
    const { target, currentTarget } = event;
    // A popover's press reaches here through React's tree, though it lies outside the card.
    if (!(target instanceof Element) || !currentTarget.contains(target)) return;
    if (target.closest(".plain-mark, .board-card-working")) titleLink.current?.click();
  };

  const markOf = (mark: CardMark): ReactNode => {
    switch (mark.kind) {
      case "waiting-on-you":
        return <StateMark key={mark.kind} words="Waiting on you" icon="hand" tone="warning" />;
      case "paused":
        return (
          <StateMark
            key={mark.kind}
            words={taskStateWords("paused", task)}
            icon="pause"
            tone="warning"
          />
        );
      case "dropped":
        return <StateMark key={mark.kind} words={taskStateWords("dropped")} icon="circle-x" />;
      case "blocked":
        return <BlockedMark key={mark.kind} blockers={blockers} projects={projects} />;
      case "queued":
        return (
          queued && (
            <QueuedCardMark
              key={mark.kind}
              task={task}
              queued={queued}
              behind={queuedBehind}
              blockers={blockers.length}
            />
          )
        );
      case "planning":
        return <StateMark key={mark.kind} words={planningNoteWords(task, planner)} icon="map" />;
      case "usage-estimate":
        return usageEstimate && <UsageEstimateMark key={mark.kind} estimate={usageEstimate} />;
      case "working":
        return (
          <span key={mark.kind} className="board-card-working">
            <WorkingMark people={peopleWorking} stageName={stageName} />
          </span>
        );
      case "plan":
        return (
          <span key={mark.kind} className="board-card-plan">
            <PlanOnCardButton task={task} />
          </span>
        );
    }
  };

  return (
    <article
      className={classes.join(" ")}
      aria-label={task.title}
      data-task-id={task.id}
      draggable={movable && !markPressed.now}
      onDragStart={(event) => {
        // A drag inside a popover reaches here through React's tree, though it lies outside the card.
        if (!event.currentTarget.contains(event.target as Node)) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <div className="board-card-head">
        {/* Most Tasks are Normal, so a card marks only High and Low. */}
        {task.priority !== "normal" && <PriorityIcon priority={task.priority} />}
        <Link
          ref={titleLink}
          to="/tasks/$taskId"
          params={{ taskId: task.id }}
          className="board-card-title"
          draggable={false}
        >
          {task.title}
        </Link>
        <TaskMenu task={task} />
      </div>
      <div
        className="board-card-marks"
        onPointerDown={markPressed.start}
        onClick={openFromPlainMark}
      >
        {project ? (
          <PlainMark words={project.name} className="board-card-project">
            <ProjectMark project={project} namedOnHover={false} />
          </PlainMark>
        ) : (
          <span className="board-card-project">{task.projectId}</span>
        )}
        {/* What the Task is, on every card, a Done one's too. */}
        <KindMark kind={task.kind} />
        {marks.map(markOf)}
      </div>
    </article>
  );
}

/** A state that needs the user, or a quiet one, as its icon with its words on hover. */
function StateMark({
  words,
  icon,
  tone,
}: {
  readonly words: string;
  readonly icon: string;
  readonly tone?: "warning";
}): ReactNode {
  return (
    <PlainMark words={words} className={tone ? `card-mark card-mark-${tone}` : "card-mark"}>
      <Icon name={icon} size={13} />
    </PlainMark>
  );
}

/** The gauge, with the Usage estimate's words on hover (spec §2.1, "Usage estimates"). */
function UsageEstimateMark({ estimate }: { readonly estimate: UsageEstimate }): ReactNode {
  const engineName = useEngineName();
  return (
    <PlainMark words={usageEstimateWords(estimate, engineName)} className="card-mark">
      <Icon name="gauge" size={13} />
    </PlainMark>
  );
}

/** The lock with how many Tasks block it; a press lists them, each a link with its Project and state. */
function BlockedMark({
  blockers,
  projects,
}: {
  readonly blockers: readonly Task[];
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const words = `Blocked by ${counted(blockers.length, "Task", "Tasks")}`;
  return (
    <Popover
      label={words}
      tooltip={`${words}: press for them`}
      triggerClassName="card-mark card-mark-pressable"
      trigger={
        <>
          <Icon name="lock" size={13} />
          {blockers.length}
        </>
      }
    >
      <p className="popover-head">
        <Icon name="lock" size={13} />
        {words}
      </p>
      <p className="popover-sub">
        {blockers.length === 1 ? "It must be Done first." : "Each must be Done first."}
      </p>
      <ul className="blockers-list">
        {blockers.map((blocker) => {
          const project = projects?.find(({ id }) => id === blocker.projectId);
          return (
            <li key={blocker.id}>
              {project ? <ProjectMark project={project} /> : <span />}
              <Link to="/tasks/$taskId" params={{ taskId: blocker.id }} draggable={false}>
                {blocker.title}
              </Link>
              <Badge tone={TASK_STATE_TONES[blocker.state]} size="sm" dot>
                {taskStateWords(blocker.state, blocker)}
              </Badge>
            </li>
          );
        })}
      </ul>
    </Popover>
  );
}

/**
 * Whether a mark that is a button, such as the lock, is being pressed: the card doesn't drag
 * meanwhile, so a press on it never starts a drag. A card still drags by a mark that only stands for
 * words, as by the rest of it.
 */
function useMarkPressed(): {
  readonly now: boolean;
  readonly start: (event: PointerEvent<HTMLElement>) => void;
} {
  const [now, setNow] = useState(false);
  useEffect(() => {
    if (!now) return;
    const end = (): void => setNow(false);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [now]);
  const start = ({ target, currentTarget }: PointerEvent<HTMLElement>): void => {
    if (target instanceof Element && currentTarget.contains(target) && target.closest("button")) {
      setNow(true);
    }
  };
  return { now, start };
}

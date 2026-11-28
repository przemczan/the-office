import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { OffBoardTask, OffBoardTaskStatus as Status } from "@the-office/contracts";
import { Alert, Badge, Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { answerDecision } from "../../api/conversations.ts";
import { OFF_BOARD_TASKS } from "../../api/off-board-tasks.ts";
import { resumeTask, startTask } from "../../api/work.ts";
import { tokensShort } from "../../shell/conversation/context-words.ts";
import { queuePlaceWords } from "./off-board-task-words.ts";
import { PersonAvatar } from "../../shell/person-avatar.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { durationWords, momentWords } from "../../shell/time.ts";
import { useClock } from "../../shell/use-clock.ts";
import { useDutyHolder } from "../../shell/use-duty-holder.ts";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const BADGES: Readonly<
  Record<Status["state"], { readonly label: string; readonly tone: Tone; readonly icon?: string }>
> = {
  queued: { label: "Queued", tone: "warning", icon: "clock" },
  running: { label: "Running", tone: "info" },
  "waiting-on-you": { label: "Waiting on you", tone: "warning" },
  paused: { label: "Paused", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  ready: { label: "Ready", tone: "neutral" },
  done: { label: "Done", tone: "success", icon: "check" },
  dropped: { label: "Dropped", tone: "neutral" },
};

/** How a Stage on the rail stands. */
type RailMark = "done" | "now" | "wait" | "fail" | undefined;

const CURRENT_MARK: Readonly<Partial<Record<Status["state"], RailMark>>> = {
  running: "now",
  "waiting-on-you": "wait",
  paused: "wait",
  failed: "fail",
};

/**
 * One Off-board Task as a Project page's card follows it (docs/design/set-up-tasks.html, "One
 * status, every kind"): its state badge and title, its Stages as a rail, a meta line and one link,
 * with what the state lets the user do from here. `children` follow it, such as the card's hint.
 */
export function OffBoardTaskStatus({
  task,
  children,
}: {
  readonly task: OffBoardTask;
  readonly children?: ReactNode;
}): ReactNode {
  const { status } = task;
  const badge = BADGES[status.state];
  return (
    <section
      className={`off-board-task is-${status.state}`}
      aria-label={`${task.title} · ${badge.label}`}
    >
      <div className="off-board-task-head">
        <Badge tone={badge.tone} dot={badge.icon === undefined}>
          {badge.icon !== undefined && <Icon name={badge.icon} size={11} />}
          {badge.label}
        </Badge>
        <span className="off-board-task-title">{task.title}</span>
        <span className="off-board-task-end">
          <HeadLink task={task} />
        </span>
      </div>
      {status.state !== "done" && status.state !== "dropped" && status.state !== "ready" && (
        <StageRail task={task} />
      )}
      <StateBody task={task} />
      {children}
    </section>
  );
}

/** "Open the Thread" while a Stage runs with a Thread to follow; "Open the Task" otherwise. */
function HeadLink({ task }: { readonly task: OffBoardTask }): ReactNode {
  if (task.status.state === "running" && task.threadId !== null) {
    return (
      <Link
        to="/tasks/$taskId"
        params={{ taskId: task.taskId }}
        search={{ taskThread: task.threadId }}
      >
        Open the Thread
      </Link>
    );
  }
  return (
    <Link to="/tasks/$taskId" params={{ taskId: task.taskId }}>
      Open the Task
    </Link>
  );
}

/** Its Pipeline's Stages in order, the ones before the current Stage done. */
function StageRail({ task }: { readonly task: OffBoardTask }): ReactNode {
  if (task.stages.length === 0) return null;
  const current =
    task.status.state === "failed" ? task.status.stageName : (task.currentStage ?? undefined);
  const at = current === undefined ? -1 : task.stages.indexOf(current);
  const markOf = (index: number): RailMark => {
    if (at < 0) return undefined;
    if (index < at) return "done";
    return index === at ? CURRENT_MARK[task.status.state] : undefined;
  };
  return (
    <ol className="off-board-task-rail" aria-label="Stages">
      {task.stages.map((stage, index) => {
        const mark = markOf(index);
        return (
          <li
            key={`${index}-${stage}`}
            className={mark === undefined ? "off-board-task-stage" : `off-board-task-stage ${mark}`}
            aria-current={index === at ? "step" : undefined}
          >
            <span className="off-board-task-dot" aria-hidden="true" />
            {stage}
          </li>
        );
      })}
    </ol>
  );
}

function StateBody({ task }: { readonly task: OffBoardTask }): ReactNode {
  const now = useClock();
  const { status } = task;
  const tokens = `${tokensShort(task.tokens)} tokens`;
  switch (status.state) {
    case "queued":
      return (
        <>
          <Meta>
            <strong>{queuePlaceWords(status.place)}</strong>
            {status.shortReasons.map((reason) => (
              <span key={reason}>{reason}</span>
            ))}
            <span>Queued for {durationWords(now.getTime() - Date.parse(status.queuedAt))}</span>
          </Meta>
          <p className="off-board-task-hint">
            It starts by itself once there is room. Move it up on Now&apos;s Queue.
          </p>
        </>
      );
    case "running":
      return (
        <Meta>
          {task.person && (
            <span className="off-board-task-person">
              <PersonAvatar roleKey={task.person.roleKey} name={task.person.name} size="xs" />
              <strong>{task.person.name}</strong>
            </span>
          )}
          <span>{durationWords(now.getTime() - Date.parse(task.since))} in Stage</span>
          <span>{tokens}</span>
        </Meta>
      );
    case "waiting-on-you":
      return <WaitingOnYou task={task} status={status} tokens={tokens} />;
    case "paused":
      return <Paused task={task} tokens={tokens} />;
    case "failed":
      return <Failed task={task} status={status} />;
    case "ready":
      return <MadeBefore task={task} />;
    case "done":
      return (
        <Meta>
          {status.endedAt !== null && <span>Done on {momentWords(status.endedAt, now)}</span>}
          <span>{tokens}</span>
        </Meta>
      );
    case "dropped":
      return (
        <Meta>
          {status.endedAt !== null && <span>Dropped on {momentWords(status.endedAt, now)}</span>}
          {status.dropReason !== null && <span>&ldquo;{status.dropReason}&rdquo;</span>}
          <span>{tokens}</span>
        </Meta>
      );
  }
}

function Meta({ children }: { readonly children: ReactNode }): ReactNode {
  return <div className="off-board-task-meta">{children}</div>;
}

function WaitingOnYou({
  task,
  status,
  tokens,
}: {
  readonly task: OffBoardTask;
  readonly status: Extract<Status, { state: "waiting-on-you" }>;
  readonly tokens: string;
}): ReactNode {
  const navigate = useNavigate();
  const now = useClock();
  return (
    <>
      {status.question !== null && (
        <div className="off-board-task-question">
          {task.person && <b>{task.person.name} asks: </b>}
          {status.question}
        </div>
      )}
      <div className="off-board-task-row">
        <Button
          size="sm"
          variant="primary"
          onClick={() =>
            void navigate({
              to: "/tasks/$taskId",
              params: { taskId: task.taskId },
              search: status.decisionId === null ? {} : { decision: status.decisionId },
            })
          }
        >
          Answer
        </Button>
        <Meta>
          <span>Asked {durationWords(now.getTime() - Date.parse(task.since))} ago</span>
          <span>{tokens}</span>
        </Meta>
      </div>
    </>
  );
}

function Paused({
  task,
  tokens,
}: {
  readonly task: OffBoardTask;
  readonly tokens: string;
}): ReactNode {
  const refreshed = useRefreshed();
  const resuming = useMutation({ mutationFn: () => resumeTask(task.taskId), onSuccess: refreshed });
  return (
    <>
      <Meta>
        <span>Paused at {momentWords(task.since)}</span>
        <span>{tokens}</span>
      </Meta>
      <div className="off-board-task-row">
        <Button
          size="sm"
          variant="secondary"
          iconLeft={<Icon name="play" size={14} />}
          loading={resuming.isPending}
          onClick={() => resuming.mutate()}
        >
          Resume
        </Button>
      </div>
      {resuming.error && <RefusalAlert title="It didn't resume" error={resuming.error} />}
    </>
  );
}

/**
 * Out of tries: while the holder of "Asked first when a Stage runs out of tries" has the Decision,
 * it says so with no Retry; then Retry answers it with its first option, no guidance, and Open the
 * Decision is for guidance, Continue with the issues or Drop.
 */
function Failed({
  task,
  status,
}: {
  readonly task: OffBoardTask;
  readonly status: Extract<Status, { state: "failed" }>;
}): ReactNode {
  const navigate = useNavigate();
  const refreshed = useRefreshed();
  const cto = useDutyHolder("asked-first-when-out-of-tries").holder;
  const retrying = useMutation({
    mutationFn: () =>
      answerDecision(status.decisionId, {
        kind: "submitted",
        answers: [{ kind: "option", option: 0 }],
      }),
    onSuccess: refreshed,
  });
  const title = `${status.stageName} failed, and its rounds are used up.`;
  if (status.withCto) {
    const name = cto?.card.name ?? "the CTO";
    const asked = cto ? `${cto.card.name} (${cto.card.title})` : "the CTO";
    return (
      <>
        <p className="off-board-task-text">
          <b>{title}</b>
        </p>
        <Meta>
          {cto && <PersonAvatar roleKey={cto.key} name={cto.card.name} size="xs" />}
          <span>
            Asked {asked} first. It comes to you, here and in Needs you, if {name} passes it on.
          </span>
        </Meta>
      </>
    );
  }
  return (
    <>
      <Alert tone="danger" title={title}>
        {status.error !== null && <pre className="off-board-task-error">{status.error}</pre>}
        <div className="off-board-task-row">
          <Button
            size="sm"
            variant="primary"
            iconLeft={<Icon name="rotate-ccw" size={14} />}
            loading={retrying.isPending}
            onClick={() => retrying.mutate()}
          >
            Retry
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              void navigate({
                to: "/tasks/$taskId",
                params: { taskId: task.taskId },
                search: { decision: status.decisionId },
              })
            }
          >
            Open the Decision
          </Button>
          <span className="off-board-task-hint">
            Retry runs {status.stageName} again, with the failure in its Brief.
          </span>
        </div>
      </Alert>
      {retrying.error && <RefusalAlert title="Nothing was retried" error={retrying.error} />}
    </>
  );
}

/** One made before Off-board Tasks started at once, Ready: it waits for Start, as before. */
function MadeBefore({ task }: { readonly task: OffBoardTask }): ReactNode {
  const refreshed = useRefreshed();
  const starting = useMutation({ mutationFn: () => startTask(task.taskId), onSuccess: refreshed });
  return (
    <>
      <p className="off-board-task-text">
        Made before Off-board Tasks started at once, so it waits for your Start.
      </p>
      <div className="off-board-task-row">
        <Button
          size="sm"
          variant="primary"
          iconLeft={<Icon name="play" size={14} />}
          loading={starting.isPending}
          onClick={() => starting.mutate()}
        >
          Start
        </Button>
      </div>
      {starting.error && <RefusalAlert title="It didn't start" error={starting.error} />}
    </>
  );
}

/**
 * A start the service refused (no Onboard Pipeline, nobody holds the duty, the fire alarm), which
 * made nothing: every reason, under the button that asked.
 */
export function StartRefusal({
  title,
  reasons,
}: {
  readonly title: string;
  readonly reasons: readonly string[];
}): ReactNode {
  return (
    <Alert tone="danger" title={title}>
      <ul className="refusal-reasons">
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </Alert>
  );
}

/** The Off-board Tasks read again once an action here answers, ahead of its events. */
function useRefreshed(): () => void {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: OFF_BOARD_TASKS });
}

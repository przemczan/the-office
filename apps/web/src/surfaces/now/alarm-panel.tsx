import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type {
  AlarmGoingOnTask,
  AlarmPausedTask,
  FireAlarmOnNow,
  FireAlarmWay,
  Project,
  Role,
} from "@the-office/contracts";
import { Badge, Button, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { nowQueries } from "../../api/notifications.ts";
import { roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { giveTheAllClear } from "../../api/work.ts";
import {
  ALL_CLEAR_CHOICES,
  allClearSummary,
  alarmStateWords,
  GOING_ON_BADGES,
  resumeWords,
  type AllClearChoice,
} from "../../shell/fire-alarm/fire-alarm-words.ts";
import { useFireAlarmReview } from "../../shell/fire-alarm/fire-alarm-review.tsx";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";

/**
 * The fire alarm on Now (spec §2.8), Office-wide whatever the Project filter shows: stopping, then
 * on, the way it was sounded, with each Task it paused and, under a softer way, each started Task
 * it lets go on; before the all clear, how each paused one would resume and at what cost, with
 * Resume, Hold or Drop for each and the total of those resuming.
 */
export function AlarmPanel({ alarm }: { readonly alarm: FireAlarmOnNow }): ReactNode {
  const review = useFireAlarmReview();
  const projects = useQuery(projectQueries.list()).data;
  const roles = useQuery(roleQueries.list()).data;
  if (review.reviewing && !alarm.stopping) {
    return <ReviewPanel alarm={alarm} projects={projects} roles={roles} />;
  }
  const softer = alarm.way === "asap" ? null : alarm.way;
  const foot = FOOT_WORDS[alarm.way];
  const stopping = alarm.stopping && softer === null;
  return (
    <section className="alarm-panel" aria-label="Fire alarm">
      <div className="alarm-panel-head">
        <Icon name="siren" size={20} />
        <div className="alarm-panel-grow">
          <h2>{stopping ? "Stopping all automated work" : alarmStateWords(alarm)}</h2>
          <p>{stopping ? STOPPING_WORDS : ON_WORDS[alarm.way]}</p>
        </div>
        <Button variant="danger" disabled={alarm.stopping} onClick={review.open}>
          All clear…
        </Button>
      </div>
      {alarm.paused.length === 0 && alarm.goingOn.length === 0 ? (
        <p className="alarm-panel-faint">Nothing was running.</p>
      ) : (
        <ul className="alarm-list">
          {alarm.paused.map((task) => (
            <li key={task.taskId}>
              <TaskLine task={task} projects={projects} roles={roles} />
              {task.resume?.kind === "publish-finished" ? (
                <Badge tone="info">Push finished</Badge>
              ) : (
                <Badge tone="warning">
                  {task.resume ? "Stopped" : "Stopping at the next safe point"}
                </Badge>
              )}
            </li>
          ))}
          {softer &&
            alarm.goingOn.map((task) => (
              <li key={task.taskId}>
                <TaskLine task={task} projects={projects} roles={roles} />
                <Badge tone="info">{GOING_ON_BADGES[softer]}</Badge>
              </li>
            ))}
        </ul>
      )}
      {foot && (
        <p className="alarm-panel-foot">
          <Icon name="info" size={13} />
          {foot}
        </p>
      )}
    </section>
  );
}

const STOPPING_WORDS =
  "Every Stage stops at its next safe point, between tool calls; anything still running after 60 seconds is stopped hard. Pushes already running finish.";

const ON_WORDS: Readonly<Record<FireAlarmWay, string>> = {
  asap: "Nothing automated runs: no Stage, no Task starts, no consultation. Chats stay open; Agents answer but run no tools unless you let them in a thread.",
  "after-stages":
    "Running Stages finish, then their Tasks pause; no new Stage or Task starts. Chats work as usual.",
  "after-tasks": "Started Tasks finish; no new Task starts. Chats work as usual.",
};

/** What answering a Task waiting on you does under each way; after the current Tasks it walks on. */
const FOOT_WORDS: Readonly<Record<FireAlarmWay, string | null>> = {
  asap: "Tasks waiting on you keep waiting; answering one doesn't restart it until the all clear.",
  "after-stages":
    "Answering a Task waiting on you lets its Stage finish; then it pauses until the all clear.",
  "after-tasks": null,
};

function ReviewPanel({
  alarm,
  projects,
  roles,
}: {
  readonly alarm: FireAlarmOnNow;
  readonly projects: readonly Project[] | undefined;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const review = useFireAlarmReview();
  const [choices, setChoices] = useState<ReadonlyMap<string, AllClearChoice>>(new Map());
  const choiceOf = (taskId: string): AllClearChoice => choices.get(taskId) ?? "resume";
  const resuming = alarm.paused.filter(({ taskId }) => choiceOf(taskId) === "resume");
  const tokens = resuming.reduce((sum, { resume }) => sum + (resume?.tokens ?? 0), 0);
  const queryClient = useQueryClient();
  const toast = useToast();
  const allClear = useMutation({
    mutationFn: () =>
      giveTheAllClear({
        hold: alarm.paused.filter(({ taskId }) => choiceOf(taskId) === "hold").map(idOf),
        drop: alarm.paused.filter(({ taskId }) => choiceOf(taskId) === "drop").map(idOf),
      }),
    onSuccess: async () => {
      toast(
        `All clear. ${resuming.length} ${resuming.length === 1 ? "Task resumes" : "Tasks resume"}.`,
      );
      review.close();
      await queryClient.invalidateQueries(nowQueries.now());
    },
  });
  return (
    <section className="alarm-panel review" aria-label="Before the all clear">
      <div className="alarm-panel-head">
        <Icon name="rotate-ccw" size={20} />
        <div className="alarm-panel-grow">
          <h2>Before the all clear</h2>
          <p>
            Each Task continues from where it stopped, through the Context policy. Hold or drop any
            of them first.
          </p>
        </div>
      </div>
      <div className="alarm-resume-list">
        {alarm.paused.length === 0 && <p className="alarm-panel-faint">Nothing to resume.</p>}
        {alarm.paused.map((task) => (
          <ResumeRow
            key={task.taskId}
            task={task}
            choice={choiceOf(task.taskId)}
            onChoose={(choice) => setChoices(new Map(choices).set(task.taskId, choice))}
            projects={projects}
            roles={roles}
          />
        ))}
      </div>
      {allClear.error && <RefusalAlert title="The all clear wasn't given" error={allClear.error} />}
      <div className="alarm-panel-actions">
        <span className="alarm-panel-faint alarm-panel-grow">
          {allClearSummary(resuming.length, tokens, alarm.paused.length - resuming.length)}
        </span>
        <Button variant="secondary" onClick={review.close}>
          Keep the alarm on
        </Button>
        <Button
          iconLeft={<Icon name="check" size={14} />}
          loading={allClear.isPending}
          onClick={() => allClear.mutate()}
        >
          {resuming.length > 0 ? `All clear: resume ${resuming.length}` : "All clear"}
        </Button>
      </div>
    </section>
  );
}

function ResumeRow({
  task,
  choice,
  onChoose,
  projects,
  roles,
}: {
  readonly task: AlarmPausedTask;
  readonly choice: AllClearChoice;
  readonly onChoose: (choice: AllClearChoice) => void;
  readonly projects: readonly Project[] | undefined;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const words = task.resume && resumeWords(task.resume);
  return (
    <div className={`alarm-resume-row${choice === "resume" ? "" : " off"}`}>
      <div className="alarm-panel-grow">
        <TaskLine task={task} projects={projects} roles={roles} />
        {words && (
          <div className="alarm-resume-how">
            <span className={`alarm-pill ${words.pill}`}>{words.pillLabel}</span>
            {words.line}
          </div>
        )}
      </div>
      <div className="alarm-choices" role="group" aria-label={`What happens to ${task.title}`}>
        {ALL_CLEAR_CHOICES.map(({ choice: each, label }) => (
          <button
            key={each}
            type="button"
            aria-pressed={choice === each}
            className={choice === each ? "on" : undefined}
            onClick={() => onChoose(each)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The Task, its Project, its Stage and who works it. */
function TaskLine({
  task,
  projects,
  roles,
}: {
  readonly task: AlarmGoingOnTask;
  readonly projects: readonly Project[] | undefined;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const { stage } = task;
  const person = stage?.role ? roles?.find(({ key }) => key === stage.role) : undefined;
  return (
    <span className="alarm-task-line">
      <ProjectChip projectId={task.projectId} projects={projects} />
      <Link to="/tasks/$taskId" params={{ taskId: task.taskId }} className="now-item-title">
        {task.title}
      </Link>
      {stage && (
        <span className="alarm-panel-faint">
          · {stage.name}
          {person ? ` · ${person.card.name}` : ""}
        </span>
      )}
    </span>
  );
}

function idOf({ taskId }: AlarmPausedTask): string {
  return taskId;
}

import { useQuery } from "@tanstack/react-query";
import type { IssueLink, Project, TaskSummary } from "@the-office/contracts";
import { Alert, Badge, Button, Icon, SearchableSelect } from "@the-office/ui";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { ciRunQueries } from "../../api/ci-runs.ts";
import { roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { changeCausedBy, changeFoundInVersion, useEveryTask } from "../../api/work.ts";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { momentWords } from "../../shell/time.ts";
import { useToast } from "../../shell/toasts.tsx";
import { useSignedInUserId } from "../../shell/use-user-name.ts";
import { KindGlyph, TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import { creatorName, NOT_STARTED } from "../../shell/work/work-words.ts";
import { TaskList, TaskPickerDialog } from "./dependencies-block.tsx";
import { foundInVersionTags, FOUND_IN_VERSION_MAX } from "./bug-words.ts";
import { useRecordChange } from "./planning-parts.tsx";

/**
 * A Bug's details (docs/design/issues-as-tasks.html, "Task page"), as a section of the Description:
 * Caused by and Found in version. Only a Bug shows it; another Kind keeps them hidden, so changing
 * back loses nothing. Editable until Done or Dropped; then read-only, its empty rows hidden. Found
 * while working on, of any Kind, is a section of its own (`FoundWhileWorkingOnSection`).
 */
export function BugSection({ task }: { readonly task: TaskSummary }): ReactNode {
  const tasks = useEveryTask().data ?? [];
  const projects = useQuery(projectQueries.list()).data;
  const [pickingCause, setPickingCause] = useState(false);
  const [changingVersion, setChangingVersion] = useState(false);
  const showToast = useToast();
  const changingCause = useRecordChange(task, (causedBy: string | null) =>
    changeCausedBy(task.id, causedBy),
  );
  const changingVersionTo = useRecordChange(task, (version: string | null) =>
    changeFoundInVersion(task.id, version),
  );
  if (task.kind !== "bug") return null;
  const editable = task.state !== "done" && task.state !== "dropped";
  const cause = tasks.find(({ id }) => id === task.causedBy);
  const onError = { onError: (error: Error) => showToast(error.message) };
  return (
    <section className="task-record-section" aria-label="Bug">
      <div className="task-record-section-head">
        <h3 className="task-record-section-title task-record-section-title-icon">
          <KindGlyph kind="bug" size={13} />
          Bug
        </h3>
      </div>
      {changingVersionTo.error && (
        <RefusalAlert title="The version wasn't saved" error={changingVersionTo.error} />
      )}
      <dl className="bug-rows">
        {(editable || task.causedBy !== null) && (
          <div className="bug-row">
            <dt>Caused by</dt>
            <dd>
              {task.causedBy === null ? (
                <span className="task-quiet">Not known</span>
              ) : (
                <TaskChip task={cause} projects={projects} />
              )}
            </dd>
            {editable && (
              <dd className="bug-row-actions">
                {task.causedBy === null ? (
                  <Button size="sm" variant="ghost" onClick={() => setPickingCause(true)}>
                    Add what caused it
                  </Button>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setPickingCause(true)}>
                      Change
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Remove what caused it"
                      loading={changingCause.isPending}
                      onClick={() => changingCause.mutate(null, onError)}
                    >
                      Remove
                    </Button>
                  </>
                )}
              </dd>
            )}
          </div>
        )}
        {(editable || task.foundInVersion !== null) && (
          <div className="bug-row">
            <dt>Found in version</dt>
            <dd>
              {changingVersion ? (
                <FoundInVersionPicker
                  task={task}
                  onChoose={(version) =>
                    changingVersionTo.mutate(version, {
                      onSuccess: () => setChangingVersion(false),
                    })
                  }
                />
              ) : task.foundInVersion === null ? (
                <span className="task-quiet">Not known</span>
              ) : (
                <Badge mono>{task.foundInVersion}</Badge>
              )}
            </dd>
            {editable && (
              <dd className="bug-row-actions">
                {changingVersion ? (
                  <Button size="sm" variant="ghost" onClick={() => setChangingVersion(false)}>
                    Cancel
                  </Button>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setChangingVersion(true)}>
                      {task.foundInVersion === null ? "Add the version" : "Change"}
                    </Button>
                    {task.foundInVersion !== null && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Remove the version"
                        loading={changingVersionTo.isPending}
                        onClick={() => changingVersionTo.mutate(null, onError)}
                      >
                        Remove
                      </Button>
                    )}
                  </>
                )}
              </dd>
            )}
          </div>
        )}
      </dl>
      {pickingCause && (
        <TaskPickerDialog
          title="What caused it?"
          text={`The Task whose change brought ${task.title} in. It can be in any Project, Done or archived too.`}
          // A Bug's cause is usually Done, so every Task but this one is offered.
          candidates={tasks.filter(({ id }) => id !== task.id)}
          projects={projects}
          noCandidates="There is no other Task to pick."
          refusalTitle="It can't be what caused it"
          pending={changingCause.isPending}
          error={changingCause.error}
          onPick={(causedBy) =>
            changingCause.mutate(causedBy, { onSuccess: () => setPickingCause(false) })
          }
          onClose={() => setPickingCause(false)}
        />
      )}
    </section>
  );
}

/**
 * The Task this one was found while working on, of any Kind, linked with its Project, Kind and
 * state: set as the Task is created, by a Bug Task Decision or in a person's Thread on that Task,
 * and never changed, so shown only while it has one.
 */
export function FoundWhileWorkingOnSection({ task }: { readonly task: TaskSummary }): ReactNode {
  const tasks = useEveryTask().data;
  const projects = useQuery(projectQueries.list()).data;
  if (task.foundWhileWorkingOn === null) return null;
  const foundWhile = tasks?.find(({ id }) => id === task.foundWhileWorkingOn);
  return (
    <section className="task-record-section" aria-label="Found while working on">
      <div className="task-record-section-head">
        <h3 className="task-record-section-title">Found while working on</h3>
      </div>
      {tasks && <TaskChip task={foundWhile} projects={projects} />}
    </section>
  );
}

/** A linked Task: its Kind, its title linking to its page and its state. */
function TaskChip({
  task,
  projects,
}: {
  readonly task: TaskSummary | undefined;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  if (!task) return <span className="task-quiet">A Task no longer readable</span>;
  const project = projects?.find(({ id }) => id === task.projectId);
  return (
    <span className="bug-task-chip">
      {project && <ProjectMark project={project} />}
      <KindGlyph kind={task.kind} size={13} />
      <Link to="/tasks/$taskId" params={{ taskId: task.id }} className="task-dependencies-title">
        {task.title}
      </Link>
      <TaskStateBadge state={task.state} />
    </span>
  );
}

/**
 * Found in version: the Project's v* tags, newest first (`GET /projects/:id/refs`), or the words
 * typed, up to 64 characters; with no tags to read, only the words.
 */
function FoundInVersionPicker({
  task,
  onChoose,
}: {
  readonly task: TaskSummary;
  readonly onChoose: (version: string | null) => void;
}): ReactNode {
  const refs = useQuery(ciRunQueries.refs(task.projectId));
  const tags = foundInVersionTags(refs.data?.tags ?? []);
  return (
    <SearchableSelect
      label="Found in version"
      labelHidden
      size="sm"
      placeholder={tags.length > 0 ? "A release tag, or your own words" : "The version, in words"}
      value={task.foundInVersion ?? ""}
      options={tags.map((tag) => ({ value: tag, label: tag }))}
      onChange={(version) => onChoose(version === "" ? null : version)}
      clearLabel="Clear the version"
      noMatches="No release tag matches"
      ownValue={{ maxLength: FOUND_IN_VERSION_MAX }}
    />
  );
}

/**
 * The Bugs this Task's work caused and the Tasks dropped as its duplicates, each listed while there
 * is one, on a Task of any Kind.
 */
export function CausedBugsSections({ task }: { readonly task: TaskSummary }): ReactNode {
  const tasks = useEveryTask().data ?? [];
  const projects = useQuery(projectQueries.list()).data;
  const causedBugs = tasks.filter(({ causedBy }) => causedBy === task.id);
  const duplicates = tasks.filter(
    ({ dropReason }) => dropReason?.kind === "duplicate" && dropReason.taskId === task.id,
  );
  return (
    <>
      {causedBugs.length > 0 && (
        <section className="task-record-section" aria-label="Caused bugs">
          <div className="task-record-section-head">
            <h3 className="task-record-section-title">Caused bugs</h3>
          </div>
          <TaskList label="Bugs its change brought in" tasks={causedBugs} projects={projects} />
        </section>
      )}
      {duplicates.length > 0 && (
        <section className="task-record-section" aria-label="Duplicates">
          <div className="task-record-section-head">
            <h3 className="task-record-section-title">Duplicates</h3>
          </div>
          <TaskList label="Dropped as duplicates of it" tasks={duplicates} projects={projects} />
        </section>
      )}
    </>
  );
}

/**
 * The GitHub issue a Task was made from (docs/design/issues-as-tasks.html, "GitHub issue linked
 * record"): its state, "#n title" linking to GitHub, its author, and who imported it and when. A
 * closed issue is an Alert while the Task hasn't started, then a muted line; a refused write-back
 * says so in a muted line.
 */
export function GitHubIssueSection({ task }: { readonly task: TaskSummary }): ReactNode {
  const issue = useQuery(projectQueries.issueLink(task.id)).data;
  const roles = useQuery(roleQueries.list()).data;
  const signedInUserId = useSignedInUserId();
  if (!issue) return null;
  const closed = issue.closedOnHostAt !== null;
  return (
    <section className="task-record-section" aria-label="GitHub issue">
      <div className="task-record-section-head">
        <h3 className="task-record-section-title task-record-section-title-icon">
          <Icon name="github" size={13} />
          GitHub issue
        </h3>
      </div>
      <p className="github-issue-line">
        <span className={closed ? "github-issue-closed" : "github-issue-open"}>
          <Icon name={closed ? "circle-check" : "circle-dot"} size={14} />
          <span className="visually-hidden">{closed ? "Closed" : "Open"}</span>
        </span>
        <a href={issue.url} target="_blank" rel="noreferrer">
          #{issue.number} {issue.title}
        </a>
        <span className="task-quiet">opened by</span>
        <a href={issue.author.url} target="_blank" rel="noreferrer">
          {issue.author.login}
        </a>
        <span className="task-quiet">
          · imported by {creatorName(issue.importedBy, roles, signedInUserId)},{" "}
          {momentWords(issue.importedAt)}
        </span>
      </p>
      <IssueClosedNote task={task} issue={issue} />
      {issue.writeBackProblem !== null && <p className="task-quiet">{issue.writeBackProblem}</p>}
    </section>
  );
}

function IssueClosedNote({
  task,
  issue,
}: {
  readonly task: TaskSummary;
  readonly issue: IssueLink;
}): ReactNode {
  if (issue.closedOnHostAt === null) return null;
  const words = `Closed on GitHub, ${momentWords(issue.closedOnHostAt)}`;
  // Once the Task has started, its issue closing is expected.
  if (!NOT_STARTED.includes(task.state)) return <p className="task-quiet">{words}</p>;
  return (
    <Alert tone="info" title={words}>
      The issue was closed before this Task started. Nothing changes here: check whether the Task is
      still needed, or drop it.
    </Alert>
  );
}

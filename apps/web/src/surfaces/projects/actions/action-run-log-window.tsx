import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  actionRunWebEventSchema,
  type ActionRun,
  type ActionRunLog,
  type WebEvent,
} from "@the-office/contracts";
import { Button, Dialog, Icon, LinkButton, Switch } from "@the-office/ui";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ACTION_RUN_CHANGED,
  actionRunQueries,
  readActionRunLog,
  stopActionRun,
} from "../../../api/action-runs.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { logLinesOf, shortCommit } from "../../../shell/test-instances/test-instance-words.ts";
import "../../../shell/test-instances/test-instances.css";
import { momentWords } from "../../../shell/time.ts";
import { useToast } from "../../../shell/toasts.tsx";
import { useStreamedLog } from "../../../shell/use-streamed-log.ts";
import { useSignedInUserId } from "../../../shell/use-user-name.ts";
import { ActionRunStateBadge } from "./action-run-parts.tsx";
import {
  DIDNT_STOP,
  isRunning,
  logTitle,
  ranFromWords,
  startedByWords,
  stoppedToast,
  tookWords,
} from "./action-run-words.ts";

/** How near the bottom the log counts as scrolled to its newest line. */
const AT_THE_END_PX = 8;

type LogState = Pick<ActionRunLog, "status" | "outcome">;

async function read(runId: string, from: number, signal: AbortSignal) {
  const answer = await readActionRunLog(runId, from, signal);
  return {
    text: answer.text,
    nextOffset: answer.nextOffset,
    state: { status: answer.status, outcome: answer.outcome },
  };
}

/**
 * A run's log (screens/project-page.md, "A run's log"): a large window of one height, as a test
 * instance's Log window is, the run's facts under its head, then the masked log, streaming while
 * it runs with Follow; Stop for a Project command or Test target run while it runs, Open the test
 * instance or Open the CI run, then Close.
 */
export function ActionRunLogWindow({
  run,
  onClose,
}: {
  readonly run: ActionRun;
  readonly onClose: () => void;
}): ReactNode {
  const log = useStreamedLog<LogState>({
    id: run.id,
    read,
    isActive: (state) => state.outcome === null,
    eventType: ACTION_RUN_CHANGED,
    isAbout: (event: WebEvent) => {
      const changed = actionRunWebEventSchema.safeParse(event);
      return (
        changed.success &&
        changed.data.type === ACTION_RUN_CHANGED &&
        changed.data.projectId === run.projectId &&
        changed.data.actionKey === run.actionKey
      );
    },
  });
  const signedInUserId = useSignedInUserId();
  const navigate = useNavigate();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const stopping = useMutation({
    mutationFn: () => stopActionRun(run.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: actionRunQueries.ofProject(run.projectId).queryKey,
      });
      showToast(stoppedToast(run.actionName));
    },
  });
  const [follow, setFollow] = useState(true);
  const body = useRef<HTMLDivElement>(null);
  const running = isRunning(run);
  const lines = logLinesOf(log.text);
  const commit = shortCommit(run.commit);

  useLayoutEffect(() => {
    if (follow && body.current && log.text !== "")
      body.current.scrollTop = body.current.scrollHeight;
  }, [follow, log.text]);

  const { testInstanceId, ciRun } = run;
  return (
    <Dialog
      size="large"
      keepsHeight
      title={logTitle(run)}
      unsavedChanges={false}
      actions={
        <>
          {run.status.kind === "test-target" && testInstanceId !== null && (
            <Button
              variant="secondary"
              iconLeft={<Icon name="flask-conical" size={14} />}
              onClick={() =>
                void navigate({
                  to: "/projects/$projectId/test-targets",
                  params: { projectId: run.projectId },
                  search: { testInstance: testInstanceId },
                })
              }
            >
              Open the test instance
            </Button>
          )}
          {run.status.kind === "workflow" && ciRun !== null && (
            <LinkButton href={ciRun.url} target="_blank" rel="noreferrer">
              <Icon name="external-link" size={14} />
              Open the CI run
            </LinkButton>
          )}
          {running && run.status.kind !== "workflow" && (
            <Button
              variant="danger"
              iconLeft={<Icon name="square" size={14} />}
              loading={stopping.isPending}
              disabled={stopping.isPending}
              onClick={() => stopping.mutate()}
            >
              Stop
            </Button>
          )}
        </>
      }
      onClose={onClose}
    >
      <div className="test-instance-log">
        <div className="test-instance-log-sub">
          <div className="test-instance-log-facts">
            <ActionRunStateBadge run={run} />
            <span className="test-instance-log-branch">
              <Icon name="git-branch" size={12} />
              {run.ranFrom.kind === "branch" ? <code>{run.branch}</code> : ranFromWords(run)}
              {commit !== undefined && (
                <>
                  {" at "}
                  <code>{commit}</code>
                </>
              )}
            </span>
            <span>
              Started by {startedByWords(run, signedInUserId)} {momentWords(run.startedAt)}
            </span>
            <span>{tookWords(run)}</span>
          </div>
          {running ? (
            <div className="test-instance-log-tools">
              <span className="test-instance-log-live">
                <span className="live-dot" aria-hidden="true" />
                Streaming
              </span>
              <Switch label="Follow" size="sm" checked={follow} onChange={setFollow} />
            </div>
          ) : (
            <span className="test-instance-log-tools">Kept with the run</span>
          )}
        </div>
        {run.note !== null && <p className="project-block-note">{run.note}</p>}
        {stopping.error && <RefusalAlert title={DIDNT_STOP} error={stopping.error} />}
        <div
          ref={body}
          className="test-instance-log-body"
          onScroll={({ currentTarget }) => {
            const fromTheEnd =
              currentTarget.scrollHeight - currentTarget.scrollTop - currentTarget.clientHeight;
            if (follow && fromTheEnd > AT_THE_END_PX) setFollow(false);
          }}
        >
          <div
            className="test-instance-log-lines"
            role="log"
            aria-label={`${run.actionName}'s log`}
          >
            {lines.length === 0 && log.state !== undefined && (
              <p className="task-quiet">Nothing written yet.</p>
            )}
            {lines.map((line, index) => (
              // The log only grows, so a line's place is its identity.
              <div key={index} className={`test-instance-log-line is-${line.kind}`}>
                {line.text}
              </div>
            ))}
            {run.outcome === "failed" &&
              run.endedBecause !== null &&
              !lines.some(({ kind }) => kind === "failed") && (
                <div className="test-instance-log-line is-failed">{run.endedBecause}</div>
              )}
          </div>
        </div>
        {log.error && <RefusalAlert title="The log can't be read" error={log.error} />}
      </div>
    </Dialog>
  );
}

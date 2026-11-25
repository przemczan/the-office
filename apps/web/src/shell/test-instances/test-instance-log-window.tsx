import { useQuery } from "@tanstack/react-query";
import type { Project, TestInstance } from "@the-office/contracts";
import { Badge, Button, Dialog, Icon, Switch } from "@the-office/ui";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { roleQueries } from "../../api/people.ts";
import { ProjectMark } from "../project-mark.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useSignedInUserId } from "../use-user-name.ts";
import {
  instanceAddress,
  isActive,
  launchedWords,
  logLinesOf,
  logTitle,
  shortCommit,
  TEST_INSTANCE_STATE_TONES,
  TEST_INSTANCE_STATE_WORDS,
} from "./test-instance-words.ts";
import { OpenTestInstanceButton } from "./open-test-instance-button.tsx";
import { useTestInstanceLog } from "./use-test-instance-log.ts";
import "./test-instances.css";

/** How near the bottom the log counts as scrolled to its newest line. */
const AT_THE_END_PX = 8;

/**
 * A test instance's Log (spec screens/initiative-page.md, "Test instances"; docs/design/
 * test-instances.html, the Log tab): a large window of one height, the facts under its head, then
 * the masked log, read on while it is Building or Running. Follow keeps the newest line in view
 * until the user scrolls up. Its bar has Open while Running and Stop while Building or Running. It
 * follows the instance as it changes, so it stays open from Building to Running to Stopped.
 */
export function TestInstanceLogWindow({
  instance,
  project,
  projectName,
  branch,
  stopping,
  onOpen,
  onStop,
  onClose,
}: {
  readonly instance: TestInstance;
  readonly project: Project | undefined;
  readonly projectName: string;
  /** The branch it runs, when it is known. */
  readonly branch: string | undefined;
  readonly stopping: boolean;
  /** Opens it at one of its addresses, by its hostname; the page's own when none. */
  readonly onOpen: (hostname?: string) => void;
  readonly onStop: () => void;
  readonly onClose: () => void;
}): ReactNode {
  const log = useTestInstanceLog(instance.id);
  const roles = useQuery(roleQueries.list()).data;
  const signedInUserId = useSignedInUserId();
  const [follow, setFollow] = useState(true);
  const body = useRef<HTMLDivElement>(null);
  const streaming = isActive(instance.state);
  const lines = logLinesOf(log.text);
  const commit = shortCommit(instance.commit);

  useLayoutEffect(() => {
    // Read on whenever the log grows; nothing to follow while it is empty.
    if (follow && body.current && log.text !== "")
      body.current.scrollTop = body.current.scrollHeight;
  }, [follow, log.text]);

  return (
    <Dialog
      size="large"
      keepsHeight
      title={logTitle(instance)}
      unsavedChanges={false}
      actions={
        <>
          {instance.state === "running" && (
            <OpenTestInstanceButton instance={instance} onOpen={onOpen} menuPlacement="above" />
          )}
          {streaming && (
            <Button
              variant="danger"
              iconLeft={<Icon name="square" size={14} />}
              loading={stopping}
              disabled={stopping}
              onClick={onStop}
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
            <Badge tone={TEST_INSTANCE_STATE_TONES[instance.state]} dot={streaming}>
              {TEST_INSTANCE_STATE_WORDS[instance.state]}
            </Badge>
            <span className="test-instance-log-project">
              {project && <ProjectMark project={project} />}
              {projectName}
            </span>
            {branch !== undefined && (
              <span className="test-instance-log-branch">
                <Icon name="git-branch" size={12} />
                <code>{branch}</code>
                {commit !== undefined && (
                  <>
                    {" at "}
                    <code>{commit}</code>
                  </>
                )}
              </span>
            )}
            <span>{launchedWords(instance, roles, signedInUserId)}</span>
            {instance.state === "running" && instance.port !== null && (
              <span className="test-instance-address">
                {instanceAddress(instance.port, window.location.hostname)}
              </span>
            )}
          </div>
          {streaming ? (
            <div className="test-instance-log-tools">
              <span className="test-instance-log-live">
                <span className="live-dot" aria-hidden="true" />
                Streaming
              </span>
              <Switch label="Follow" size="sm" checked={follow} onChange={setFollow} />
            </div>
          ) : (
            <span className="test-instance-log-tools">Kept with the instance</span>
          )}
        </div>
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
            aria-label={`${instance.targetName}'s log`}
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
          </div>
        </div>
        {log.error && <RefusalAlert title="The log can't be read" error={log.error} />}
      </div>
    </Dialog>
  );
}

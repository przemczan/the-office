import { Link } from "@tanstack/react-router";
import type { LaunchableTestTarget, TestInstance } from "@the-office/contracts";
import { Badge, Button, FoldButton, Icon, LinkButton } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { testBuildFileAddress } from "../../api/test-instances.ts";
import { fileSizeWords } from "../repository-files/repository-files-words.ts";
import { entryPointWords, TEST_TARGET_KIND_LABELS } from "../test-target-words.ts";
import { useClock } from "../use-clock.ts";
import {
  branchMovedPast,
  earlierWords,
  FILES_REMOVED,
  instanceAddress,
  instanceLine,
  isActive,
  launchDisabledWhy,
  NEEDS_RUN_ENVIRONMENT,
  needsRunEnvironment,
  NEWER_COMMITS,
  TEST_INSTANCE_STATE_TONES,
  TEST_INSTANCE_STATE_WORDS,
} from "./test-instance-words.ts";
import type { TestInstanceActions } from "./use-test-instance-actions.ts";
import "./test-instances.css";

/**
 * A test target's row (docs/design/test-instances.html), on the Initiative page and a Project's
 * page: its name and kind, its newest instance with what it can do (Open, Stop, Launch, Log), a
 * Built instance's files, then the earlier instances folded under it.
 */
export function TestTargetLaunchRow({
  projectName,
  runEnvironmentOn,
  branchCommit,
  target,
  instances,
  launchKey,
  onLaunch,
  actions,
  filesNote,
  aboutInstance,
}: {
  readonly projectName: string;
  readonly runEnvironmentOn: boolean;
  /** The tip of the branch it launches on, as far as The Office knows it. */
  readonly branchCommit: string | null;
  readonly target: LaunchableTestTarget;
  /** Its instances on the branch shown, newest first. */
  readonly instances: readonly TestInstance[];
  /** The `key` its launches carry, so the row knows its own is waiting. */
  readonly launchKey: string;
  readonly onLaunch: () => void;
  readonly actions: TestInstanceActions;
  /** Under a Built instance's files, such as when they are removed. */
  readonly filesNote?: string;
  /** What else an instance's line says, such as the Initiative it is linked to. */
  readonly aboutInstance?: (instance: TestInstance) => ReactNode;
}): ReactNode {
  const now = useClock();
  const [newest, ...earlier] = instances;
  const [earlierOpen, setEarlierOpen] = useState(false);
  const launching = actions.launchingKey === launchKey;
  const launchable = !actions.readOnly && (newest === undefined || !isActive(newest.state));
  const runEnvironmentMissing = needsRunEnvironment(target) && !runEnvironmentOn;
  return (
    <li className="test-instances-target" aria-label={target.name}>
      <div className="test-instances-row">
        <div className="test-instances-main">
          <div className="test-instances-line">
            <span className="test-instances-name">{target.name}</span>
            <Badge size="sm">
              <Icon name={target.kind === "hosted" ? "globe" : "package"} size={11} />
              {TEST_TARGET_KIND_LABELS[target.kind]}
            </Badge>
          </div>
          <div className="test-instances-meta">
            {newest === undefined ? (
              <>
                <span>Not launched yet</span>
                <Separator />
                <code className="test-instances-entry-point">
                  {entryPointWords(target.entryPoint)}
                </code>
              </>
            ) : (
              <>
                <TestInstanceStateBadge instance={newest} />
                {newest.state === "running" && newest.port !== null && (
                  <span className="test-instance-address">
                    {instanceAddress(newest.port, window.location.hostname)}
                  </span>
                )}
                <span>{instanceLine(newest, now)}</span>
                {aboutInstance?.(newest)}
                {newest.state === "built" && newest.filesRemoved && (
                  <span className="test-instances-files-removed">{FILES_REMOVED}</span>
                )}
                {branchMovedPast(newest, branchCommit) && (
                  <span
                    className="test-instances-newer"
                    title="Launch again to try the branch's newest commit"
                  >
                    <Icon name="triangle-alert" size={12} />
                    {NEWER_COMMITS}
                  </span>
                )}
              </>
            )}
          </div>
          {newest?.state === "failed" && newest.failedReason !== null && (
            <p className="test-instances-reason">{newest.failedReason}</p>
          )}
        </div>
        <div className="test-instances-actions">
          {newest?.state === "running" && (
            <Button
              size="sm"
              variant="primary"
              iconLeft={<Icon name="external-link" size={14} />}
              title={`Open ${target.name} in a new tab`}
              onClick={() => actions.open(newest)}
            >
              Open
            </Button>
          )}
          {newest !== undefined && isActive(newest.state) && (
            <Button
              size="sm"
              variant="secondary"
              iconLeft={<Icon name="square" size={14} />}
              loading={actions.stoppingId === newest.id}
              disabled={actions.stoppingId === newest.id}
              onClick={() => actions.stop(newest)}
            >
              Stop
            </Button>
          )}
          {launchable && (
            <Button
              size="sm"
              variant="secondary"
              iconLeft={<Icon name={newest === undefined ? "play" : "rotate-cw"} size={14} />}
              loading={launching}
              disabled={runEnvironmentMissing || launching}
              title={runEnvironmentMissing ? launchDisabledWhy(projectName) : undefined}
              onClick={onLaunch}
            >
              {newest === undefined ? "Launch" : "Launch again"}
            </Button>
          )}
          {newest !== undefined && (
            <Button
              size="sm"
              variant="ghost"
              iconLeft={<Icon name="scroll-text" size={14} />}
              onClick={() => actions.showLog(newest)}
            >
              Log
            </Button>
          )}
        </div>
      </div>
      {newest?.state === "built" && !newest.filesRemoved && newest.files.length > 0 && (
        <BuiltFiles instance={newest} actions={actions} note={filesNote} />
      )}
      {earlier.length > 0 && (
        <div className="test-instances-earlier">
          <FoldButton
            className="test-instances-earlier-toggle"
            unfolded={earlierOpen}
            onClick={() => setEarlierOpen(!earlierOpen)}
          >
            {earlierWords(earlier.length)}
          </FoldButton>
          {earlierOpen && (
            <ul className="test-instances-earlier-list" aria-label={`Earlier ${target.name}`}>
              {earlier.map((instance) => (
                <li key={instance.id}>
                  <TestInstanceStateBadge instance={instance} />
                  <span>{instanceLine(instance, now)}</span>
                  {aboutInstance?.(instance)}
                  <Button
                    size="sm"
                    variant="ghost"
                    iconLeft={<Icon name="scroll-text" size={14} />}
                    onClick={() => actions.showLog(instance)}
                  >
                    Log
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * "Needs Run environment On to launch." over a Project's rows while its Run environment isn't On,
 * linking to its Run environment section.
 */
export function NeedsRunEnvironmentNote({
  projectId,
  projectName,
}: {
  readonly projectId: string;
  readonly projectName: string;
}): ReactNode {
  return (
    <div className="test-instances-note" role="note">
      <Icon name="triangle-alert" size={14} />
      <span>
        {NEEDS_RUN_ENVIRONMENT}{" "}
        <Link to="/projects/$projectId/run-environment" params={{ projectId }}>
          Turn it on in {projectName}&apos;s Run environment section
        </Link>
        .
      </span>
    </div>
  );
}

/** A Built instance's files, each with Download, behind sign-in, and its QR code for a phone. */
function BuiltFiles({
  instance,
  actions,
  note,
}: {
  readonly instance: TestInstance;
  readonly actions: TestInstanceActions;
  readonly note: string | undefined;
}): ReactNode {
  return (
    <div className="test-instances-files">
      <ul aria-label={`Files of ${instance.targetName}`}>
        {instance.files.map(({ name: fileName, size }) => {
          const linking = actions.linkingFile === `${instance.id}/${fileName}`;
          return (
            <li key={fileName} className="test-instances-file" aria-label={fileName}>
              <Icon name="file" size={14} />
              <code className="test-instances-file-name">{fileName}</code>
              <span className="test-instances-file-size">· {fileSizeWords(size)}</span>
              <span className="test-instances-file-actions">
                <LinkButton
                  className="link-button test-instances-file-download"
                  href={testBuildFileAddress(instance.id, fileName)}
                  download={fileName}
                >
                  <Icon name="download" size={14} />
                  Download
                </LinkButton>
                <Button
                  size="sm"
                  variant="ghost"
                  iconLeft={<Icon name="qr-code" size={14} />}
                  title={`A QR code to install ${fileName} on a phone`}
                  loading={linking}
                  disabled={linking}
                  onClick={() => actions.showQrCode(instance, fileName)}
                >
                  QR code
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
      {note !== undefined && <p className="test-instances-files-note">{note}</p>}
    </div>
  );
}

export function TestInstanceStateBadge({
  instance,
}: {
  readonly instance: TestInstance;
}): ReactNode {
  return (
    <Badge size="sm" tone={TEST_INSTANCE_STATE_TONES[instance.state]}>
      {instance.state === "building" && (
        <span className="test-instances-spinner" aria-hidden="true">
          <Icon name="loader-circle" size={11} />
        </span>
      )}
      {TEST_INSTANCE_STATE_WORDS[instance.state]}
    </Badge>
  );
}

function Separator(): ReactNode {
  return (
    <span className="test-instances-separator" aria-hidden="true">
      ·
    </span>
  );
}

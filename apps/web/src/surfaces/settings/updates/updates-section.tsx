import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  OfficeCommit,
  OfficeReleaseNote,
  OfficeUpdate,
  OfficeUpdateTarget,
} from "@the-office/contracts";
import { Alert, Button, Card, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  cancelOfficeRestart,
  cancelOfficeUpdate,
  checkForUpdates,
  OFFICE_UPDATE_LOG_URL,
  officeUpdateQueries,
  scheduleOfficeUpdate,
} from "../../../api/office-updates.ts";
import { MarkdownDocument } from "../../../shell/markdown-text.tsx";
import { usePageHeading } from "../../../shell/page-heading.tsx";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { dayOf, momentWords } from "../../../shell/time.ts";
import { SettingsCardTitle, SettingsProblem } from "../settings-card-parts.tsx";
import { useRestartScheduling } from "./restart-scheduling.ts";
import { installNote, installWords, lastResultWords, waitingWords } from "./updates-words.ts";
import "./updates.css";

/**
 * Settings › Updates (spec §5.1 Defaults, "Updating The Office"): how The Office was installed
 * and the version it runs, Check for updates, and Update, which waits for the work going on and then
 * has the launcher or the Office updater install the newest commit or release and start The Office
 * again; and Restart The Office, which waits the same way, then has the launcher or Docker start it
 * again.
 */
export function UpdatesSection(): ReactNode {
  usePageHeading({ title: "Settings", crumb: "Updates" });
  const officeUpdate = useQuery(officeUpdateQueries.officeUpdate());
  return (
    <>
      {officeUpdate.data && (
        <p className="settings-note">{installNote(officeUpdate.data.install)}</p>
      )}
      {officeUpdate.data && <VersionCard officeUpdate={officeUpdate.data} />}
      {officeUpdate.data && <RestartCard officeUpdate={officeUpdate.data} />}
      {officeUpdate.data?.scheduled && <ScheduledCard officeUpdate={officeUpdate.data} />}
      {officeUpdate.data?.lastResult && <LastResultCard officeUpdate={officeUpdate.data} />}
      <SettingsProblem title="The Office's version can't be read" error={officeUpdate.error} />
    </>
  );
}

function VersionCard({ officeUpdate }: { readonly officeUpdate: OfficeUpdate }): ReactNode {
  const queryClient = useQueryClient();
  const checking = useMutation({
    mutationFn: checkForUpdates,
    onSuccess: (checked) => {
      queryClient.setQueryData(officeUpdateQueries.officeUpdate().queryKey, checked);
    },
  });
  const scheduling = useMutation({
    mutationFn: scheduleOfficeUpdate,
    onSettled: () => queryClient.invalidateQueries(officeUpdateQueries.officeUpdate()),
  });
  const { install, version, current, check, refusal, scheduled } = officeUpdate;
  const behind = check?.behind ?? [];
  const releases = check?.releases ?? [];
  const updateButton = !scheduled && (
    <Button
      size="sm"
      iconLeft={<Icon name="download" size={14} />}
      loading={scheduling.isPending}
      disabled={refusal !== undefined}
      title={refusal}
      onClick={() => scheduling.mutate()}
    >
      Update
    </Button>
  );
  return (
    <Card title={<SettingsCardTitle icon="refresh-cw">Version</SettingsCardTitle>}>
      <div className="updates-card-body">
        <div className="updates-row">
          <span className="updates-version" aria-label="Current version">
            {version && (
              <>
                <strong>{version}</strong> ·{" "}
              </>
            )}
            <CommitWords commit={current} />
          </span>
          <span className="settings-note" aria-label="How The Office was installed">
            {installWords(install)}
          </span>
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Icon name="refresh-cw" size={14} />}
            loading={checking.isPending || officeUpdate.checking}
            onClick={() => checking.mutate()}
          >
            Check for updates
          </Button>
        </div>
        {check && (
          <p className="settings-note">
            Checked {momentWords(check.checkedAt)}.
            {behind.length === 0 &&
              releases.length === 0 &&
              !check.problem &&
              " The Office is up to date."}
          </p>
        )}
        {check?.problem && (
          <Alert tone="warning" title="The check couldn't fetch">
            {check.problem}
          </Alert>
        )}
        {behind.length > 0 && (
          <section className="updates-available" aria-label="Update available">
            <div className="updates-row">
              <strong>Update available</strong>
              <span className="settings-note">
                {behind.length === 1 ? "1 commit" : `${behind.length} commits`}
              </span>
              {updateButton}
            </div>
            <ul className="updates-commits" aria-label="Commits behind">
              {behind.map((commit) => (
                <li key={commit.commit}>
                  <code>{commit.shortCommit}</code> {commit.subject}
                </li>
              ))}
            </ul>
          </section>
        )}
        {releases.length > 0 && <ReleasesAvailable releases={releases} action={updateButton} />}
        {refusal && (
          <Alert tone="warning" title="Update is refused">
            {refusal}
          </Alert>
        )}
        {checking.error && <RefusalAlert title="The check failed" error={checking.error} />}
        {scheduling.error && (
          <RefusalAlert title="The update wasn't scheduled" error={scheduling.error} />
        )}
      </div>
    </Card>
  );
}

/** Restart The Office, refused with the reason while nothing would start it again. */
function RestartCard({ officeUpdate }: { readonly officeUpdate: OfficeUpdate }): ReactNode {
  const scheduling = useRestartScheduling();
  const { restart, scheduled } = officeUpdate;
  return (
    <Card title={<SettingsCardTitle icon="rotate-cw">Restart</SettingsCardTitle>}>
      <div className="updates-card-body">
        <div className="updates-row">
          <span className="settings-note">Waits for the work going on, as an update does.</span>
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Icon name="rotate-cw" size={14} />}
            loading={scheduling.isPending}
            disabled={restart.refusal !== undefined || scheduled !== undefined}
            title={restart.refusal}
            onClick={() => scheduling.mutate()}
          >
            Restart The Office
          </Button>
        </div>
        {restart.refusal && !scheduled && (
          <Alert tone="warning" title="Restart is refused">
            {restart.refusal}
          </Alert>
        )}
        {scheduling.error && (
          <RefusalAlert title="The restart wasn't scheduled" error={scheduling.error} />
        )}
      </div>
    </Card>
  );
}

/** A scheduled update or restart, with what it waits for and Cancel. */
function ScheduledCard({ officeUpdate }: { readonly officeUpdate: OfficeUpdate }): ReactNode {
  const queryClient = useQueryClient();
  const scheduled = officeUpdate.scheduled;
  const restart = scheduled?.kind === "restart";
  const cancelling = useMutation({
    mutationFn: restart ? cancelOfficeRestart : cancelOfficeUpdate,
    onSettled: () => queryClient.invalidateQueries(officeUpdateQueries.officeUpdate()),
  });
  if (!scheduled) return null;
  const waitsFor = restart ? "What the restart waits for" : "What the update waits for";
  return (
    <Card
      title={
        <SettingsCardTitle icon="clock">
          {restart ? "Restart scheduled" : "Update scheduled"}
        </SettingsCardTitle>
      }
    >
      <div className="updates-card-body">
        <div className="updates-row">
          <span>
            {scheduled.kind === "update" && (
              <>
                To <TargetWords target={scheduled.target} />.{" "}
              </>
            )}
            {waitingWords(scheduled.busy.length, scheduled.kind)}
          </span>
          <Button
            variant="secondary"
            size="sm"
            loading={cancelling.isPending}
            onClick={() => cancelling.mutate()}
          >
            Cancel
          </Button>
        </div>
        {scheduled.busy.length > 0 && (
          <ul className="updates-busy" aria-label={waitsFor}>
            {scheduled.busy.map((item, index) => (
              <li key={`${item.label}-${index}`}>{item.label}</li>
            ))}
          </ul>
        )}
        <p className="settings-note">
          Meanwhile, new Starts join the queue and each Task waits before its next Stage.
        </p>
        {cancelling.error && (
          <RefusalAlert
            title={restart ? "The restart wasn't cancelled" : "The update wasn't cancelled"}
            error={cancelling.error}
          />
        )}
      </div>
    </Card>
  );
}

function LastResultCard({ officeUpdate }: { readonly officeUpdate: OfficeUpdate }): ReactNode {
  const result = officeUpdate.lastResult;
  if (!result) return null;
  return (
    <Card title={<SettingsCardTitle icon="history">Last update</SettingsCardTitle>}>
      <div className="updates-card-body">
        <Alert
          tone={result.outcome === "updated" ? "success" : "danger"}
          title={lastResultWords(result)}
          action={
            <a
              className="updates-link"
              href={OFFICE_UPDATE_LOG_URL}
              target="_blank"
              rel="noreferrer"
            >
              View the log
            </a>
          }
        >
          {momentWords(result.finishedAt)}
        </Alert>
      </div>
    </Card>
  );
}

/** The newer releases, newest first: the newest's notes open, the older ones' folded. */
function ReleasesAvailable({
  releases,
  action,
}: {
  readonly releases: readonly OfficeReleaseNote[];
  readonly action: ReactNode;
}): ReactNode {
  const [newest] = releases;
  if (!newest) return null;
  return (
    <section className="updates-available" aria-label="Update available">
      <div className="updates-row">
        <strong>Version {newest.version} available</strong>
        {releases.length > 1 && (
          <span className="settings-note">{releases.length} newer versions</span>
        )}
        {action}
      </div>
      <ul className="updates-releases" aria-label="Newer versions">
        {releases.map((release, index) => (
          <li key={release.version}>
            <details className="updates-release" open={index === 0}>
              <summary className="updates-release-heading">
                <span className="updates-release-chevron">
                  <Icon name="chevron-right" size={14} />
                </span>
                <strong>{release.version}</strong>
                {release.name !== release.version && <span>{release.name}</span>}
                <span className="settings-note">{dayOf(release.publishedAt)}</span>
              </summary>
              <div className="updates-release-notes">
                {release.notes.trim() ? (
                  <MarkdownDocument text={release.notes} />
                ) : (
                  <p className="settings-note">This release has no notes.</p>
                )}
                <a className="updates-link" href={release.url} target="_blank" rel="noreferrer">
                  Release notes
                </a>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TargetWords({ target }: { readonly target: OfficeUpdateTarget }): ReactNode {
  if (target.kind === "commit") return <CommitWords commit={target} />;
  return (
    <>
      <strong>{target.version}</strong> · {dayOf(target.publishedAt)}
    </>
  );
}

function CommitWords({ commit }: { readonly commit: OfficeCommit }): ReactNode {
  return (
    <>
      <code>{commit.shortCommit}</code> · {commit.subject} · {momentWords(commit.committedAt)}
    </>
  );
}

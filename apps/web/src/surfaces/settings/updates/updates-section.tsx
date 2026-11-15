import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OfficeCommit, OfficeUpdate } from "@the-office/contracts";
import { Alert, Button, Card, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  cancelOfficeUpdate,
  checkForUpdates,
  OFFICE_UPDATE_LOG_URL,
  officeUpdateQueries,
  scheduleOfficeUpdate,
} from "../../../api/office-updates.ts";
import { usePageHeading } from "../../../shell/page-heading.tsx";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { momentWords } from "../../../shell/time.ts";
import { SettingsCardTitle, SettingsProblem } from "../settings-card-parts.tsx";
import { lastResultWords, waitingWords } from "./updates-words.ts";
import "./updates.css";

/**
 * Settings › Updates (spec §5.1 Defaults, "Updating The Office"): the version The Office runs,
 * Check for updates, and Update, which waits for the work going on and then has the launcher
 * install the newest commit and start The Office again.
 */
export function UpdatesSection(): ReactNode {
  usePageHeading({ title: "Settings", crumb: "Updates" });
  const officeUpdate = useQuery(officeUpdateQueries.officeUpdate());
  return (
    <>
      <p className="settings-note">
        The Office updates its own checkout to the newest commit of its upstream branch. A check
        runs every day and installs nothing; Update waits until nobody is mid-turn and nothing runs,
        then The Office restarts on the new version.
      </p>
      {officeUpdate.data && <VersionCard officeUpdate={officeUpdate.data} />}
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
  const { version, current, check, refusal, scheduled } = officeUpdate;
  const behind = check?.behind ?? [];
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
            {behind.length === 0 && !check.problem && " The Office is up to date."}
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
              {!scheduled && (
                <Button
                  size="sm"
                  iconLeft={<Icon name="download" size={14} />}
                  loading={scheduling.isPending}
                  disabled={refusal !== undefined}
                  onClick={() => scheduling.mutate()}
                >
                  Update
                </Button>
              )}
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

function ScheduledCard({ officeUpdate }: { readonly officeUpdate: OfficeUpdate }): ReactNode {
  const queryClient = useQueryClient();
  const cancelling = useMutation({
    mutationFn: cancelOfficeUpdate,
    onSettled: () => queryClient.invalidateQueries(officeUpdateQueries.officeUpdate()),
  });
  const scheduled = officeUpdate.scheduled;
  if (!scheduled) return null;
  return (
    <Card title={<SettingsCardTitle icon="clock">Update scheduled</SettingsCardTitle>}>
      <div className="updates-card-body">
        <div className="updates-row">
          <span>
            To <CommitWords commit={scheduled.target} />. {waitingWords(scheduled.busy.length)}
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
          <ul className="updates-busy" aria-label="What the update waits for">
            {scheduled.busy.map((item, index) => (
              <li key={`${item.label}-${index}`}>{item.label}</li>
            ))}
          </ul>
        )}
        <p className="settings-note">
          Meanwhile, new Starts join the queue and each Task waits before its next Stage.
        </p>
        {cancelling.error && (
          <RefusalAlert title="The update wasn't cancelled" error={cancelling.error} />
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

function CommitWords({ commit }: { readonly commit: OfficeCommit }): ReactNode {
  return (
    <>
      <code>{commit.shortCommit}</code> · {commit.subject} · {momentWords(commit.committedAt)}
    </>
  );
}

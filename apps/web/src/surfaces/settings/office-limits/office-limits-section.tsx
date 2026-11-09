import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ARCHIVE_PERIOD_MAX,
  OFFICE_WIDE_LIMIT_MAX,
  SIZE_THRESHOLD_TOKENS,
} from "@the-office/contracts";
import { Card, Stepper } from "@the-office/ui";
import type { ReactNode } from "react";
import { changeSizeThreshold, sizeThresholdQuery } from "../../../api/conversations.ts";
import { nowQueries } from "../../../api/notifications.ts";
import {
  archivePeriodQuery,
  changeArchivePeriod,
  changeOfficeWideLimit,
  officeWideLimitQuery,
} from "../../../api/work.ts";
import { tokensShort } from "../../../shell/conversation/context-words.ts";
import { usePageHeading } from "../../../shell/page-heading.tsx";
import { SettingsCardTitle, SettingsProblem } from "../settings-card-parts.tsx";
import { RunEnvironmentsCard } from "./run-environments-card.tsx";
import { UsageCard } from "./usage-card.tsx";

/**
 * Settings › Office limits: the desks, the usage measures and caps, the size threshold, the
 * Archive period and the run environments' CPU limit.
 */
export function OfficeLimitsSection(): ReactNode {
  usePageHeading({ title: "Settings", crumb: "Office limits" });
  return (
    <>
      <DesksCard />
      <UsageCard />
      <SizeThresholdCard />
      <ArchiveCard />
      <RunEnvironmentsCard />
    </>
  );
}

function DesksCard(): ReactNode {
  const queryClient = useQueryClient();
  const limit = useQuery(officeWideLimitQuery());
  const now = useQuery(nowQueries.now());
  const saving = useMutation({
    mutationFn: changeOfficeWideLimit,
    onSuccess: (saved) => queryClient.setQueryData(officeWideLimitQuery().queryKey, saved),
  });
  return (
    <Card title={<SettingsCardTitle icon="gauge">Desks</SettingsCardTitle>}>
      <div className="stepper-row">
        <div className="stepper-row-words">
          <b>Running Tasks at once across The Office</b>
          <p className="settings-note">
            Talking is never limited: chats, consultations and Decisions don&apos;t take a desk.
          </p>
        </div>
        {limit.data && (
          <Stepper
            label="running Tasks at once"
            value={limit.data.officeWideLimit}
            min={1}
            max={OFFICE_WIDE_LIMIT_MAX}
            disabled={saving.isPending}
            onChange={(officeWideLimit) => saving.mutate(officeWideLimit)}
          />
        )}
      </div>
      <p className="settings-note stepper-note">
        {now.data && `${now.data.desks.inUse} in use now. `}
        Lowering it lets running Tasks finish; nothing new starts until one ends.
      </p>
      <SettingsProblem title="The limit can't be read" error={limit.error} />
      <SettingsProblem title="The limit can't be saved" error={saving.error} />
    </Card>
  );
}

function SizeThresholdCard(): ReactNode {
  const queryClient = useQueryClient();
  const threshold = useQuery(sizeThresholdQuery());
  const saving = useMutation({
    mutationFn: changeSizeThreshold,
    onSuccess: (saved) => queryClient.setQueryData(sizeThresholdQuery().queryKey, saved),
  });
  return (
    <Card title={<SettingsCardTitle icon="layers">Context policy</SettingsCardTitle>}>
      <div className="stepper-row">
        <div className="stepper-row-words">
          <b>Size threshold</b>
          <p className="settings-note">
            Once a Thread&apos;s cache has cooled, an hour after its last call, its next message
            starts a fresh session with a Brief if the conversation has added more than this since
            the session began; below it, the session continues.
          </p>
        </div>
        {threshold.data && (
          <Stepper
            label="the size threshold"
            value={threshold.data.sizeThreshold}
            min={SIZE_THRESHOLD_TOKENS.min}
            max={SIZE_THRESHOLD_TOKENS.max}
            step={SIZE_THRESHOLD_TOKENS.step}
            format={tokensShort}
            disabled={saving.isPending}
            onChange={(sizeThreshold) => saving.mutate(sizeThreshold)}
          />
        )}
      </div>
      <p className="settings-note stepper-note">
        It applies from each Thread&apos;s next message; a person&apos;s session default decides
        whether it is used.
      </p>
      <SettingsProblem title="The size threshold can't be read" error={threshold.error} />
      <SettingsProblem title="The size threshold can't be saved" error={saving.error} />
    </Card>
  );
}

function ArchiveCard(): ReactNode {
  const queryClient = useQueryClient();
  const period = useQuery(archivePeriodQuery());
  const saving = useMutation({
    mutationFn: changeArchivePeriod,
    onSuccess: (saved) => queryClient.setQueryData(archivePeriodQuery().queryKey, saved),
  });
  return (
    <Card title={<SettingsCardTitle icon="archive">Archive</SettingsCardTitle>}>
      <div className="stepper-row">
        <div className="stepper-row-words">
          <b>Archive period</b>
          <p className="settings-note">
            Done and Dropped Tasks finished longer ago than this are archived at the next daily run,
            including those already finished.
          </p>
        </div>
        {period.data && (
          <Stepper
            label="the Archive period"
            value={period.data.archivePeriod}
            min={1}
            max={ARCHIVE_PERIOD_MAX}
            format={daysWords}
            disabled={saving.isPending}
            onChange={(archivePeriod) => saving.mutate(archivePeriod)}
          />
        )}
      </div>
      <p className="settings-note stepper-note">
        A restored Task gets a full period again from its Restore. A change applies from the next
        daily run.
      </p>
      <SettingsProblem title="The Archive period can't be read" error={period.error} />
      <SettingsProblem title="The Archive period can't be saved" error={saving.error} />
    </Card>
  );
}

function daysWords(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}

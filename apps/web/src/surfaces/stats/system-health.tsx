import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  SYSTEM_HEALTH_RANGES,
  systemHealthRangeSchema,
  type SystemHealth,
  type SystemHealthLoadNow,
  type SystemHealthRange,
} from "@the-office/contracts";
import { Alert, Button, Icon, Skeleton } from "@the-office/ui";
import type { ReactNode } from "react";
import { statsQueries, telemetryQueries } from "../../api/telemetry.ts";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { FullStatsAlert, SettingsLink } from "./full-stats.tsx";
import {
  CpuAndMemoryBlock,
  DatabaseBlock,
  RequestsBlock,
  ResponsivenessBlock,
  type HealthBlockProps,
} from "./health-blocks.tsx";
import { OfficeWideBadge, Picker, StatsBlock } from "./stats-parts.tsx";
import { StatsFrame } from "./stats-tabs.tsx";
import {
  ENVIRONMENT_STEP,
  MESSAGE_WORDS,
  NO_DATA,
  RANGE,
  statsMessageOf,
  TRY_AGAIN,
  type StatsMessage,
} from "./stats-words.ts";
import {
  clockSecondsWords,
  clockWords,
  COULDNT_READ,
  couldntReadWords,
  HEALTH_RANGE_LABELS,
  lastAnswerWords,
  LOAD_FIGURES,
  LOAD_NOW,
  LOAD_NOW_WHEN,
  LOADING_HEALTH,
  LONGER_RANGES,
  LONGER_UNTIL_EXPORT,
  LONGER_UNTIL_GRAFANA,
  LONGER_WORDS,
  NO_DATA_HEALTH_TEXT,
  SHOW_THE_LAST_HOUR,
  SOURCE_LONGER,
  sourceHourWords,
  updatedWords,
} from "./system-health-words.ts";
import "./stats.css";

/** The range System health shows, kept in the address as `?range=`, 1 h when none is named. */
export function useHealthRange(): readonly [SystemHealthRange, (range: SystemHealthRange) => void] {
  const search: Record<string, unknown> = useSearch({ strict: false });
  const navigate = useNavigate();
  const range = healthRangeOf(search["range"]);
  const setRange = (picked: SystemHealthRange): void => {
    void navigate({
      to: "/stats/system-health",
      search: picked === "1h" ? {} : { range: picked },
      replace: true,
    });
  };
  return [range, setRange];
}

/** The range an address names, 1 h for none or one System health doesn't offer. */
export function healthRangeOf(value: unknown): SystemHealthRange {
  const parsed = systemHealthRangeSchema.safeParse(value);
  return parsed.success ? parsed.data : "1h";
}

/**
 * Stats' System health tab (spec 2.11, System health), at /stats/system-health: Load now on every
 * range, then Responsiveness, CPU and memory, Requests and Database, every block Office-wide. 1 h
 * comes from The Office's own Health readings, read every 5 s while the tab is visible; the longer
 * ranges from Grafana, every minute, in Tokens and cost's words when Grafana can't answer.
 */
export function SystemHealthPage(): ReactNode {
  const [range, setRange] = useHealthRange();
  const { filter } = useProjectFilter();
  const health = useQuery({
    ...statsQueries.systemHealth(range),
    placeholderData: keepPreviousData,
  });
  const telemetry = useQuery(telemetryQueries.settings());
  const hour = range === "1h";
  // The answer for this range; a new range keeps the last one's Load now while it loads.
  const answer = health.isPlaceholderData ? undefined : health.data;
  const failed = health.isError;
  const loading = answer === undefined && !failed;
  const readings = answer?.readings;
  const drawn = loading || readings?.state === "read";
  const tryAgain = (): void => void health.refetch();
  const blockProps: HealthBlockProps = {
    readings: readings?.state === "read" ? readings : undefined,
    range,
    loading,
    filtered: filter !== "all",
    onTryAgain: tryAgain,
    trying: health.isFetching,
  };
  const answeredAt = health.dataUpdatedAt > 0 ? health.dataUpdatedAt : undefined;
  const picker = (
    <div className="stats-range">
      <Picker
        label={RANGE}
        options={SYSTEM_HEALTH_RANGES.map((value) => ({
          value,
          label: HEALTH_RANGE_LABELS[value],
        }))}
        value={range}
        onChange={setRange}
      />
    </div>
  );
  return (
    <StatsFrame shown="health" picker={picker}>
      {drawn && <SourceLine answer={answer} hour={hour} answeredAt={answeredAt} failed={failed} />}
      {failed ? (
        <Alert
          tone="danger"
          title={COULDNT_READ}
          action={
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<Icon name="rotate-cw" size={13} />}
              disabled={health.isFetching}
              aria-busy={health.isFetching || undefined}
              onClick={tryAgain}
            >
              {TRY_AGAIN}
            </Button>
          }
        >
          {couldntReadWords(
            answer && answeredAt !== undefined ? clockSecondsWords(answeredAt) : undefined,
          )}
        </Alert>
      ) : (
        readings && (
          <GrafanaAlert readings={readings} onTryAgain={tryAgain} trying={health.isFetching} />
        )
      )}
      {(answer !== undefined || !failed) && (
        <div className="stats-blocks">
          <LoadNow loadNow={health.data?.loadNow} filtered={filter !== "all"} />
          {drawn ? (
            <>
              <ResponsivenessBlock {...blockProps} />
              <CpuAndMemoryBlock {...blockProps} />
              <RequestsBlock {...blockProps} />
              <DatabaseBlock {...blockProps} />
            </>
          ) : (
            readings && (
              <LongerRangesMessage
                readings={readings}
                message={telemetry.data ? statsMessageOf(telemetry.data) : null}
                onLastHour={() => setRange("1h")}
              />
            )
          )}
        </div>
      )}
    </StatsFrame>
  );
}

/**
 * Under the tabs: where the figures come from, and when they were read. A failed read says when
 * the last answer came, with no live dot.
 */
function SourceLine({
  answer,
  hour,
  answeredAt,
  failed,
}: {
  readonly answer: SystemHealth | undefined;
  readonly hour: boolean;
  readonly answeredAt: number | undefined;
  readonly failed: boolean;
}): ReactNode {
  if (answer === undefined || answeredAt === undefined) {
    return (
      <p className="stats-source">
        <Skeleton width={420} height={12} style={{ maxWidth: "100%" }} />
      </p>
    );
  }
  const { readings } = answer;
  const since =
    readings.state === "read" && readings.readingsSince !== undefined
      ? Date.parse(readings.readingsSince)
      : undefined;
  const from = readings.state === "read" ? Date.parse(readings.from) : 0;
  // Started within the hour: to the second, as the hatching before it shows.
  const started =
    since === undefined ? undefined : since > from ? clockSecondsWords(since) : clockWords(since);
  return (
    <p className="stats-source">
      <Icon name={hour ? "activity" : "calendar"} size={13} />
      {hour ? sourceHourWords(started ?? clockWords(from)) : SOURCE_LONGER}
      <span className="stats-source-updated">
        {failed ? (
          lastAnswerWords(clockSecondsWords(answeredAt))
        ) : (
          <>
            <span className="stats-live-dot" aria-hidden="true" />
            {updatedWords(hour ? clockSecondsWords(answeredAt) : clockWords(answeredAt), hour)}
          </>
        )}
      </span>
    </p>
  );
}

/** The longer ranges' Grafana state above the blocks, in Tokens and cost's words. */
function GrafanaAlert({
  readings,
  onTryAgain,
  trying,
}: {
  readonly readings: SystemHealth["readings"];
  readonly onTryAgain: () => void;
  readonly trying: boolean;
}): ReactNode {
  switch (readings.state) {
    case "read":
    case "not-on":
      return null;
    case "no-data":
      return (
        <Alert tone="info" title={NO_DATA}>
          {NO_DATA_HEALTH_TEXT}
        </Alert>
      );
    default:
      return <FullStatsAlert stats={readings} onTryAgain={onTryAgain} trying={trying} />;
  }
}

/** Load now: what is running, read now whatever the range; its figures' places until the first. */
function LoadNow({
  loadNow,
  filtered,
}: {
  readonly loadNow: SystemHealthLoadNow | undefined;
  readonly filtered: boolean;
}): ReactNode {
  return (
    <StatsBlock
      id="health-load"
      className="stats-span-12"
      title={LOAD_NOW}
      badge={<OfficeWideBadge filtered={filtered} />}
      when={LOAD_NOW_WHEN}
      loading={false}
      loaderLabel={LOADING_HEALTH}
    >
      <div className="stats-load">
        {LOAD_FIGURES.map((figure) => (
          <div key={figure.key} className="stats-load-figure" role={loadNow ? undefined : "status"}>
            <span className="stats-load-icon">
              <Icon name={figure.icon} size={16} />
            </span>
            {loadNow ? (
              <>
                <div className="stats-load-head">
                  <span className="stats-load-number">{loadNow[figure.key]}</span>
                  <span className="stats-load-label">{figure.label}</span>
                </div>
                <p className="stats-load-text">{figure.text}</p>
              </>
            ) : (
              <>
                <span className="visually-hidden">{LOADING_HEALTH}</span>
                <Skeleton width="60%" height={22} />
                <Skeleton width="80%" height={10} />
              </>
            )}
          </div>
        ))}
      </div>
    </StatsBlock>
  );
}

/**
 * The longer ranges with no Grafana to read: why, its next step, and Show the last hour, which
 * needs no Grafana.
 */
function LongerRangesMessage({
  readings,
  message,
  onLastHour,
}: {
  readonly readings: SystemHealth["readings"];
  readonly message: StatsMessage | null;
  readonly onLastHour: () => void;
}): ReactNode {
  const basic: StatsMessage | null = readings.state === "not-on" ? (message ?? "off") : null;
  const title =
    basic !== null
      ? MESSAGE_WORDS[basic]
      : readings.state === "no-data"
        ? LONGER_UNTIL_EXPORT
        : LONGER_UNTIL_GRAFANA;
  return (
    <section className="stats-message stats-span-12" aria-label={LONGER_RANGES}>
      <span className="stats-message-icon">
        <Icon name="activity" size={18} />
      </span>
      <div className="stats-message-words">
        <p className="stats-message-title">{title}</p>
        <p className="stats-message-text">{LONGER_WORDS}</p>
        <div className="stats-message-actions">
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Icon name="clock" size={13} />}
            onClick={onLastHour}
          >
            {SHOW_THE_LAST_HOUR}
          </Button>
          {basic === "environment" ? (
            <span className="stats-message-step">
              {ENVIRONMENT_STEP} <SettingsLink />
            </span>
          ) : (
            basic !== null && <SettingsLink />
          )}
        </div>
      </div>
    </section>
  );
}

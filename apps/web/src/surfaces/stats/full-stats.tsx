import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  FULL_STATS_RANGES,
  fullStatsRangeSchema,
  type FullStats,
  type FullStatsRange,
  type FullStatsRead,
  type FullStatsSplit,
  type Project,
} from "@the-office/contracts";
import { Alert, Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { CostliestWork } from "./costliest-work.tsx";
import { Picker } from "./stats-parts.tsx";
import {
  COVERAGE,
  GRAFANA_FAILED,
  GRAFANA_REJECTED,
  GRAFANA_STARTING,
  GRAFANA_STARTING_TEXT,
  NO_DATA,
  NO_DATA_TEXT,
  RANGE,
  RANGE_LABELS,
  rejectedWords,
  SETTINGS_TELEMETRY,
  TRY_AGAIN,
  UNREACHABLE_TEXT,
  unreachableWords,
} from "./stats-words.ts";
import { UsageOverTime } from "./usage-over-time.tsx";
import { WindowsOverTime } from "./windows-over-time.tsx";

/** The range the full stats show, kept in the address as `?range=`, 7 d when none is named. */
export function useStatsRange(): readonly [FullStatsRange, (range: FullStatsRange) => void] {
  const search: Record<string, unknown> = useSearch({ strict: false });
  const navigate = useNavigate();
  const range = statsRangeOf(search["range"]);
  const setRange = (picked: FullStatsRange): void => {
    void navigate({
      to: "/stats",
      search: picked === "7d" ? {} : { range: picked },
      replace: true,
    });
  };
  return [range, setRange];
}

/** The range an address names, 7 d for none or one Stats doesn't offer. */
export function statsRangeOf(value: unknown): FullStatsRange {
  const parsed = fullStatsRangeSchema.safeParse(value);
  return parsed.success ? parsed.data : "7d";
}

/** 24 h, 7 d or 30 d, in the page's head while the full stats show. */
export function RangePicker({
  range,
  onChange,
}: {
  readonly range: FullStatsRange;
  readonly onChange: (range: FullStatsRange) => void;
}): ReactNode {
  return (
    <div className="stats-range">
      <Picker
        label={RANGE}
        options={FULL_STATS_RANGES.map((value) => ({ value, label: RANGE_LABELS[value] }))}
        value={range}
        onChange={onChange}
      />
    </div>
  );
}

/** Under the range: what the full stats cover. */
export function CoverageLine(): ReactNode {
  return (
    <p className="stats-coverage">
      <Icon name="calendar" size={13} />
      {COVERAGE}
    </p>
  );
}

/** The link to Settings › Telemetry, every state's next step. */
export function SettingsLink(): ReactNode {
  return (
    <Link to="/settings/telemetry" className="stats-settings-link">
      {SETTINGS_TELEMETRY}
      <Icon name="arrow-right" size={13} />
    </Link>
  );
}

/**
 * What a state other than Full and Basic says, above the stats (spec 2.11, States); nothing for
 * those two, whose words are the coverage line and the message at the foot.
 */
export function FullStatsAlert({
  stats,
  onTryAgain,
  trying,
}: {
  readonly stats: FullStats;
  readonly onTryAgain: () => void;
  readonly trying: boolean;
}): ReactNode {
  switch (stats.state) {
    case "not-on":
    case "full":
      return null;
    case "starting":
      return (
        <Alert tone="info" title={GRAFANA_STARTING}>
          {GRAFANA_STARTING_TEXT}
        </Alert>
      );
    case "failed":
      return (
        <Alert tone="danger" title={GRAFANA_FAILED} action={<SettingsLink />}>
          {stats.problem}
        </Alert>
      );
    case "unreachable":
      return (
        <Alert
          tone="danger"
          title={unreachableWords(stats.address)}
          action={
            <span className="stats-alert-actions">
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<Icon name="rotate-cw" size={13} />}
                disabled={trying}
                aria-busy={trying || undefined}
                onClick={onTryAgain}
              >
                {TRY_AGAIN}
              </Button>
              <SettingsLink />
            </span>
          }
        >
          {stats.problem ?? UNREACHABLE_TEXT}
        </Alert>
      );
    case "rejected":
      return (
        <Alert tone="danger" title={GRAFANA_REJECTED} action={<SettingsLink />}>
          {rejectedWords(stats.address)}
        </Alert>
      );
    case "no-data":
      return (
        <Alert tone="info" title={NO_DATA}>
          {NO_DATA_TEXT}
        </Alert>
      );
  }
}

/** The full stats' blocks, in the design's order; each its loader while `loading`. */
export function FullStatsBlocks({
  stats,
  loading,
  range,
  split,
  onSplit,
  filtered,
  projects,
}: {
  readonly stats: FullStatsRead | undefined;
  readonly loading: boolean;
  readonly range: FullStatsRange;
  readonly split: FullStatsSplit;
  readonly onSplit: (split: FullStatsSplit) => void;
  readonly filtered: boolean;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  return (
    <>
      <UsageOverTime stats={stats} loading={loading} split={split} onSplit={onSplit} />
      <CostliestWork stats={stats} loading={loading} range={range} projects={projects} />
      <WindowsOverTime stats={stats} loading={loading} filtered={filtered} projects={projects} />
    </>
  );
}

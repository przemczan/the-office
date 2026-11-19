import { useNavigate } from "@tanstack/react-router";
import { Tabs } from "@the-office/ui";
import type { ReactNode } from "react";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { STATS_SUB, STATS_TITLE } from "./stats-words.ts";
import { SYSTEM_HEALTH, TOKENS_AND_COST } from "./system-health-words.ts";
import "./stats.css";

/** Stats' tabs, each with the address it goes to; its label is the top bar's crumb too. */
export const STATS_TABS = [
  { value: "cost", label: TOKENS_AND_COST, to: "/stats" },
  { value: "health", label: SYSTEM_HEALTH, to: "/stats/system-health" },
] as const;

export type StatsTab = (typeof STATS_TABS)[number]["value"];

/**
 * Stats' page (spec 2.11, Place): its head, then packages/ui's Tabs under it, as Work's are, each
 * going to its address, with the tab's range picker at the right end of their row (it wraps under
 * them on a narrow page). The top bar's crumb names the tab.
 */
export function StatsFrame({
  shown,
  picker,
  children,
}: {
  readonly shown: StatsTab;
  /** The tab's range picker, when it has one now. */
  readonly picker?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const tab = STATS_TABS.find(({ value }) => value === shown) ?? STATS_TABS[0];
  usePageHeading({ title: STATS_TITLE, crumb: tab.label });
  const navigate = useNavigate();
  return (
    <div className="stats-page">
      <div className="stats-page-head">
        <div className="stats-page-words">
          <h2 className="stats-page-title">{STATS_TITLE}</h2>
          <p className="stats-page-sub">{STATS_SUB}</p>
        </div>
      </div>
      <div className="stats-tabs">
        <Tabs
          tabs={STATS_TABS.map(({ value, label }) => ({ value, label }))}
          value={shown}
          onChange={(value) => {
            const picked = STATS_TABS.find((candidate) => candidate.value === value);
            if (picked !== undefined && picked.value !== shown) {
              void navigate({ to: picked.to, search: {} });
            }
          }}
        />
        {picker}
      </div>
      {children}
    </div>
  );
}

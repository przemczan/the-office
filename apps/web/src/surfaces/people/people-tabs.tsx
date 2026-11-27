import { useMatchRoute, useNavigate } from "@tanstack/react-router";
import { Tabs } from "@the-office/ui";
import type { ReactNode } from "react";

const TABS = [
  { value: "people", label: "People", to: "/people" },
  { value: "authority", label: "Authority", to: "/authority" },
] as const;

/** People's tabs: the grid of people, and everyone's Authority side by side. */
export function PeopleTabs(): ReactNode {
  const matchRoute = useMatchRoute();
  const navigate = useNavigate();
  const shown = TABS.find(({ to }) => matchRoute({ to })) ?? TABS[0];
  return (
    <Tabs
      tabs={TABS.map(({ value, label }) => ({ value, label }))}
      value={shown.value}
      onChange={(value) => {
        const tab = TABS.find((candidate) => candidate.value === value) ?? TABS[0];
        void navigate({ to: tab.to });
      }}
    />
  );
}

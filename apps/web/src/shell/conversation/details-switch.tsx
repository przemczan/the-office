import { Switch } from "@the-office/ui";
import type { ReactNode } from "react";
import { useDetails } from "./details-store.ts";

/** Shows or hides tool activity and the context lines, in every Thread's log at once. */
export function DetailsSwitch(): ReactNode {
  const details = useDetails();
  // The group names the switch: the design system's labelled Switch leaves its role unnamed.
  return (
    <div
      className="details-switch"
      role="group"
      aria-label="Details"
      title="Tool activity and context lines"
    >
      <Switch size="sm" label="Details" checked={details.on} onChange={details.choose} />
    </div>
  );
}

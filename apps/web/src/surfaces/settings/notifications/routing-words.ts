import type { Channel, RoutedChannel } from "@the-office/contracts";
import type { DesktopPermission } from "../../../shell/notifications/desktop-channel.ts";

/** A row of the grid: one level of the kinds tree, as the service keys it. */
export interface RoutingRow {
  readonly level: string;
  readonly label: string;
  readonly hint?: string;
}

export interface RoutingGroup extends RoutingRow {
  readonly kinds: readonly RoutingRow[];
}

/** The kinds tree as the grid shows it (prototypes/app/data.js `notificationKinds`). */
export const ROUTING_GROUPS: readonly RoutingGroup[] = [
  {
    level: "needs-you",
    label: "Needs you",
    kinds: [
      {
        level: "needs-you.decision",
        label: "Decision waiting",
        hint: "including limits, final failures and hard switches",
      },
      { level: "needs-you.gate", label: "Gate waiting" },
      {
        level: "needs-you.message",
        label: "A message to you",
        hint: "including a mention in a consultation",
      },
    ],
  },
  {
    level: "outcomes",
    label: "Outcomes",
    kinds: [
      { level: "outcomes.task-done", label: "Task done" },
      { level: "outcomes.task-failed", label: "Task failed" },
      { level: "outcomes.task-paused", label: "Task paused" },
      { level: "outcomes.initiative-done", label: "Initiative done" },
    ],
  },
  {
    level: "office",
    label: "Office",
    kinds: [
      { level: "office.window", label: "A usage window nearly used, used up or reset" },
      { level: "office.down", label: "The service or an Agent engine down" },
      { level: "office.alarm-lifted", label: "Alarm lifted with work waiting" },
      { level: "office.update.done", label: "The Office updated" },
      { level: "office.update.failed", label: "An Office update failed" },
    ],
  },
];

export interface RoutingColumn {
  readonly channel: Channel;
  readonly label: string;
}

export const ROUTING_COLUMNS: readonly RoutingColumn[] = [
  { channel: "in-app", label: "In-app" },
  { channel: "desktop", label: "Desktop" },
  { channel: "phone", label: "Phone" },
];

/** What each column's channel is, under its name; the phone is set up in task 28. */
export function columnNote(channel: Channel, desktop: DesktopPermission): string {
  if (channel === "in-app") return "Toast, tab title and status strip";
  if (channel === "phone") return "Not set up yet";
  return DESKTOP_NOTES[desktop];
}

const DESKTOP_NOTES: Readonly<Record<DesktopPermission, string>> = {
  granted: "Allowed in this browser",
  default: "Not allowed in this browser yet",
  denied: "Blocked in this browser",
  unsupported: "Not in this browser",
};

function labelOf(level: string): string {
  const rows = ROUTING_GROUPS.flatMap((group) => [group, ...group.kinds]);
  return rows.find((row) => row.level === level)?.label ?? level;
}

/** Whether the row sets the channel itself, rather than taking it from its group. */
export function isSetHere(level: string, routed: RoutedChannel): boolean {
  return routed.from === level;
}

/** Where a cell's value comes from, as its title says it. */
export function cellTitle(level: string, routed: RoutedChannel): string {
  if (isSetHere(level, routed)) return "Set here";
  return routed.from === null ? "Off" : `Inherited from ${labelOf(routed.from)}`;
}

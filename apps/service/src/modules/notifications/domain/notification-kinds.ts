/**
 * The kinds of Notification, as hierarchical keys (spec §2.7): a group, then the kind, and later
 * finer kinds below it (`needs-you.decision.limit-reached`). Routing set at a level reaches every
 * kind below it, so splitting a kind keeps every setting.
 */
export const NOTIFICATION_KINDS = [
  "needs-you.decision",
  "needs-you.gate",
  "needs-you.message",
  "outcomes.task-done",
  "outcomes.task-failed",
  "outcomes.task-paused",
  "office.window-nearly-used",
  "office.window-reset",
  "office.service-down",
  "office.engine-down",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Where a Notification reaches the user in tier 1; phone push comes with tier 2. */
export const CHANNELS = ["in-app", "desktop"] as const;
export type Channel = (typeof CHANNELS)[number];

/** What one level of the tree sets: on or off for some channels, the rest left to the levels above. */
export type ChannelSettings = Readonly<Partial<Record<Channel, boolean>>>;

/** Routing stored by level, from a group (`office`) down to any kind below it. */
export type Routing = Readonly<Record<string, ChannelSettings>>;

/**
 * Spec §2.7's defaults: Needs you and Outcomes go in-app and to the desktop; Office kinds in-app,
 * and "service or engine down" also to the desktop.
 */
export const DEFAULT_ROUTING: Routing = {
  "needs-you": { "in-app": true, desktop: true },
  outcomes: { "in-app": true, desktop: true },
  office: { "in-app": true, desktop: false },
  "office.service-down": { desktop: true },
  "office.engine-down": { desktop: true },
};

/** "Window nearly used" at 90% of the 5-hour window: a default, told to the user (task 16). */
export const WINDOW_NEARLY_USED_PERCENT = 90;

/** The kind's own key and each level above it, nearest first: `a.b.c`, `a.b`, `a`. */
export function levelsOf(kind: string): string[] {
  const parts = kind.split(".");
  return parts.map((_, index) => parts.slice(0, parts.length - index).join("."));
}

/** The channels a kind goes to: each channel as the nearest level that sets it says, else off. */
export function channelsOf(kind: string, routing: Routing = DEFAULT_ROUTING): Channel[] {
  const levels = levelsOf(kind);
  return CHANNELS.filter(
    (channel) =>
      levels.map((level) => routing[level]?.[channel]).find((set) => set !== undefined) ?? false,
  );
}

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
  "outcomes.initiative-done",
  "office.window.nearly-used",
  "office.window.reset",
  "office.down.service",
  "office.down.engine",
  "office.alarm-lifted",
  "office.update.done",
  "office.update.failed",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Where a Notification reaches the user: in-app and the desktop live in the browser. */
export const CHANNELS = ["in-app", "desktop", "phone"] as const;
export type Channel = (typeof CHANNELS)[number];

/** What one level of the tree sets: on or off for some channels, the rest left to the levels above. */
export type ChannelSettings = Readonly<Partial<Record<Channel, boolean>>>;

/** Routing stored by level, from a group (`office`) down to any kind below it. */
export type Routing = Readonly<Record<string, ChannelSettings>>;

/**
 * Ticket 20's defaults (spec §2.7): Needs you goes in-app, to the desktop and the phone; Outcomes
 * in-app and to the desktop, a failed or paused Task also to the phone; Office kinds in-app, and
 * "the service or an Agent engine down" also to the desktop and the phone. The migration that made
 * `notification_routing` stored them.
 */
export const DEFAULT_ROUTING: Routing = {
  "needs-you": { "in-app": true, desktop: true, phone: true },
  outcomes: { "in-app": true, desktop: true, phone: false },
  "outcomes.task-failed": { phone: true },
  "outcomes.task-paused": { phone: true },
  office: { "in-app": true, desktop: false, phone: false },
  "office.down": { desktop: true, phone: true },
};

/** "Window nearly used" at 90% of the 5-hour window: a default, told to the user (task 16). */
export const WINDOW_NEARLY_USED_PERCENT = 90;

/** The kind's own key and each level above it, nearest first: `a.b.c`, `a.b`, `a`. */
export function levelsOf(kind: string): string[] {
  const parts = kind.split(".");
  return parts.map((_, index) => parts.slice(0, parts.length - index).join("."));
}

/** Every level routing can be set at: each kind and the levels above it, groups first. */
export const ROUTING_LEVELS: readonly string[] = [
  ...new Set(NOTIFICATION_KINDS.flatMap((kind) => levelsOf(kind).toReversed())),
];

export function isRoutingLevel(level: string): boolean {
  return ROUTING_LEVELS.includes(level);
}

/** How a channel reaches a level: on or off, and the nearest level that says so (none: off). */
export interface RoutedChannel {
  readonly on: boolean;
  readonly from: string | undefined;
}

/** The channel at this level, as the nearest level that sets it says. */
export function routedChannel(level: string, channel: Channel, routing: Routing): RoutedChannel {
  const from = levelsOf(level).find((each) => routing[each]?.[channel] !== undefined);
  return { on: from === undefined ? false : routing[from]?.[channel] === true, from };
}

/** The channels a kind goes to: each channel as the nearest level that sets it says, else off. */
export function channelsOf(kind: string, routing: Routing): Channel[] {
  return CHANNELS.filter((channel) => routedChannel(kind, channel, routing).on);
}

/** A group, the top of the tree, has no level above to inherit from. */
export function isGroup(level: string): boolean {
  return !level.includes(".");
}

/**
 * The routing once the user sets a channel at a level. A setting that matches what the level above
 * gives is dropped, so the level inherits again; a group always keeps it.
 */
export function withChannelSet(
  routing: Routing,
  level: string,
  channel: Channel,
  on: boolean,
): Routing {
  const parent = levelsOf(level)[1];
  const inherits = parent !== undefined && routedChannel(parent, channel, routing).on === on;
  const { [channel]: _replaced, ...others } = routing[level] ?? {};
  return withLevel(routing, level, inherits ? others : { ...others, [channel]: on });
}

/** The routing once a level gives every channel back to the levels above it. */
export function withLevelReset(routing: Routing, level: string): Routing {
  return withLevel(routing, level, {});
}

function withLevel(routing: Routing, level: string, settings: ChannelSettings): Routing {
  const { [level]: _replaced, ...others } = routing;
  return Object.keys(settings).length === 0 ? others : { ...others, [level]: settings };
}

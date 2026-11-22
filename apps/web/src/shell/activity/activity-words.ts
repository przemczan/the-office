import type {
  ActivityItem,
  ActivityItemKind,
  ActivityOffBoardTaskState,
} from "@the-office/contracts";
import { CI_RUN_STATUS_WORDS } from "../ci-run-status-words.ts";
import { tokensShort } from "../conversation/context-words.ts";
import { DEVICE_STATE_TONES, DEVICE_STATE_WORDS } from "../device-state-words.ts";
import { ENVIRONMENT_CHECK_STATE_WORDS } from "../environment-check-words.ts";
import {
  TEST_INSTANCE_STATE_TONES,
  TEST_INSTANCE_STATE_WORDS,
} from "../test-instances/test-instance-words.ts";
import { durationWords } from "../time.ts";
import type { Tone } from "../tone-words.ts";
import { TASK_STATE_NAMES, TASK_STATE_TONES } from "../work/work-words.ts";

/** One section of the Activity panel: the kinds it lists, under its icon and name. */
export interface ActivityGroup {
  readonly key: string;
  readonly title: string;
  readonly icon: string;
  readonly kinds: readonly ActivityItemKind[];
}

/** The page's sections, in the order it shows them; each kind is in exactly one. */
export const ACTIVITY_GROUPS: readonly ActivityGroup[] = [
  { key: "tasks", title: "Tasks", icon: "list-checks", kinds: ["task"] },
  {
    key: "test-instances",
    title: "Test instances",
    icon: "flask-conical",
    kinds: ["test-instance"],
  },
  { key: "ci-runs", title: "CI runs", icon: "workflow", kinds: ["ci-run"] },
  {
    key: "off-board-tasks",
    title: "Off-board Tasks and environment checks",
    icon: "wrench",
    kinds: ["onboarding", "run-environment-set-up", "environment-check"],
  },
  {
    key: "connected-devices",
    title: "Connected devices",
    icon: "smartphone",
    kinds: ["connected-device"],
  },
  {
    key: "pull-requests",
    title: "Pull requests",
    icon: "git-pull-request",
    kinds: ["pull-request"],
  },
  {
    key: "stalled-tasks",
    title: "Stalled Tasks",
    icon: "circle-alert",
    kinds: ["failed-task", "stopped-task"],
  },
];

export interface GroupedActivity {
  readonly group: ActivityGroup;
  readonly items: readonly ActivityItem[];
}

/**
 * The groups that have items, in the page's order, each with the running items first, then the
 * newest by when it entered its state.
 */
export function groupedActivity(items: readonly ActivityItem[]): readonly GroupedActivity[] {
  return ACTIVITY_GROUPS.map((group) => ({
    group,
    items: items.filter(({ kind }) => group.kinds.includes(kind)).toSorted(runningThenNewest),
  })).filter(({ items: grouped }) => grouped.length > 0);
}

function runningThenNewest(first: ActivityItem, second: ActivityItem): number {
  if (first.ended !== second.ended) return first.ended ? 1 : -1;
  return Date.parse(second.since) - Date.parse(first.since);
}

/** An item's state as its badge says it. */
export interface StateWords {
  readonly label: string;
  readonly tone: Tone;
}

export function stateWords(item: ActivityItem): StateWords {
  switch (item.kind) {
    case "task":
      return { label: TASK_STATE_NAMES[item.state], tone: TASK_STATE_TONES[item.state] };
    case "onboarding":
    case "run-environment-set-up":
      return OFF_BOARD_TASK_STATE_WORDS[item.state];
    case "failed-task":
      return { label: "Failed", tone: "danger" };
    case "stopped-task":
      return { label: "Stopped", tone: "warning" };
    case "test-instance":
      return {
        label: TEST_INSTANCE_STATE_WORDS[item.state],
        tone: TEST_INSTANCE_STATE_TONES[item.state],
      };
    case "ci-run": {
      const { label, tone } = CI_RUN_STATUS_WORDS[item.status];
      return { label, tone };
    }
    case "environment-check":
      return ENVIRONMENT_CHECK_STATE_WORDS[item.state];
    case "connected-device":
      return { label: DEVICE_STATE_WORDS[item.state], tone: DEVICE_STATE_TONES[item.state] };
    case "pull-request":
      return { label: "Ready to merge", tone: "success" };
  }
}

/** An Off-board Task's states, as its item's badge says them: at a desk it is Running. */
const OFF_BOARD_TASK_STATE_WORDS: Readonly<Record<ActivityOffBoardTaskState, StateWords>> = {
  queued: { label: "Queued", tone: "info" },
  "in-progress": { label: "Running", tone: TASK_STATE_TONES["in-progress"] },
  "waiting-on-you": {
    label: TASK_STATE_NAMES["waiting-on-you"],
    tone: TASK_STATE_TONES["waiting-on-you"],
  },
  paused: { label: TASK_STATE_NAMES.paused, tone: TASK_STATE_TONES.paused },
  failed: { label: "Failed", tone: "danger" },
  done: { label: TASK_STATE_NAMES.done, tone: TASK_STATE_TONES.done },
  dropped: { label: TASK_STATE_NAMES.dropped, tone: TASK_STATE_TONES.dropped },
};

/** Which Off-board Task an item is, beside its state; none for every other kind. */
export function kindWords(item: ActivityItem): string | undefined {
  switch (item.kind) {
    case "onboarding":
      return "Onboarding run";
    case "run-environment-set-up":
      return "Run environment set-up";
    default:
      return undefined;
  }
}

const DAY = 24 * 60 * 60_000;

/** How long the item has been in its state: "Running for 18 min", "Failed for 3 days". */
export function inStateWords(item: ActivityItem, now: Date): string {
  return `${stateWords(item).label} for ${spanWords(now.getTime() - Date.parse(item.since))}`;
}

/** "18 min", "2h 10 min", then whole days from a day on: "1 day", "3 days". */
export function spanWords(milliseconds: number): string {
  if (milliseconds < DAY) return durationWords(Math.max(0, milliseconds));
  const days = Math.floor(milliseconds / DAY);
  return days === 1 ? "1 day" : `${days} days`;
}

/** What the item adds under its title, such as the Stage that failed; nothing for most. */
export function detailWords(item: ActivityItem): string | undefined {
  switch (item.kind) {
    case "failed-task":
      return `Failed in ${item.stageName}`;
    case "stopped-task":
      return `Stopped in ${item.stageName}`;
    case "test-instance":
      return item.branch ?? undefined;
    case "pull-request":
      return `#${item.number}`;
    case "onboarding":
    case "run-environment-set-up":
      return offBoardDetailWords(item);
    default:
      return undefined;
  }
}

/**
 * An Off-board Task's line: its queue place and short reasons while queued, else the Stage it is
 * at or failed at and its tokens so far.
 */
function offBoardDetailWords(
  item: Extract<ActivityItem, { kind: "onboarding" | "run-environment-set-up" }>,
): string | undefined {
  if (item.queued) return [`Place ${item.queued.place}`, ...item.queued.shortReasons].join(" · ");
  const tokens = item.tokens > 0 ? `${tokensShort(item.tokens)} tokens` : undefined;
  const parts = [item.stageName, tokens].filter((part) => part !== undefined && part !== null);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** Where an item lives in The Office, and its page on the code host when it has one. */
export type ActivityPlace =
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "initiative"; readonly initiativeId: string }
  | { readonly kind: "test-targets"; readonly projectId: string }
  | { readonly kind: "environment"; readonly projectId: string }
  | { readonly kind: "ci-runs"; readonly url: string }
  | { readonly kind: "pull-requests"; readonly url: string };

export function activityPlaceOf(item: ActivityItem): ActivityPlace {
  switch (item.kind) {
    case "task":
    case "failed-task":
    case "stopped-task":
    case "onboarding":
    case "run-environment-set-up":
    case "connected-device":
      return { kind: "task", taskId: item.taskId };
    case "test-instance":
      return item.initiativeId === null
        ? { kind: "test-targets", projectId: item.projectId }
        : { kind: "initiative", initiativeId: item.initiativeId };
    case "ci-run":
      return { kind: "ci-runs", url: item.url };
    case "environment-check":
      return { kind: "environment", projectId: item.projectId };
    case "pull-request":
      return { kind: "pull-requests", url: item.url };
  }
}

/** "3 running, 2 ended not yet seen": what the strip's figure and the panel's description count. */
export function activityCountWords(items: readonly ActivityItem[]): string {
  const ended = items.filter((item) => item.ended).length;
  const running = items.length - ended;
  return `${running} running${ended > 0 ? `, ${ended} ended not yet seen` : ""}`;
}

export const NOTHING_RUNNING = "Nothing is running.";
export const NOTHING_RUNNING_HERE = "Nothing is running in these Projects.";
export const WHAT_SHOWS_HERE =
  "Tasks at a desk, test instances, CI runs, environment checks and Connected devices show here while they run.";

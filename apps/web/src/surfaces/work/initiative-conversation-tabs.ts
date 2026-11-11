import type { Thread } from "@the-office/contracts";
import { CTO_ROLE_KEY } from "../../shell/work/use-cto.ts";
import { PLANNER_ROLE_KEY } from "../../shell/work/use-planner.ts";
import { threadsInOrder } from "./timeline-words.ts";

/** A person's tab in an Initiative's conversation. */
export interface InitiativeTab {
  readonly roleKey: string;
  /** Their Threads on the Initiative, the oldest first; the composer writes to the newest. */
  readonly threads: readonly Thread[];
}

/** Shaping comes before planning, so the CTO leads; each has a tab even before their first Thread. */
const ALWAYS_SHOWN = [CTO_ROLE_KEY, PLANNER_ROLE_KEY] as const;

/** The CTO's and the Planner's tabs, then anyone else's with a Thread here, in the order they joined. */
export function initiativeTabs(threads: readonly Thread[]): InitiativeTab[] {
  const inOrder = threadsInOrder(threads);
  const others = [...new Set(inOrder.map(({ roleKey }) => roleKey))].filter(
    (roleKey) => !ALWAYS_SHOWN.some((shown) => shown === roleKey),
  );
  return [...ALWAYS_SHOWN, ...others].map((roleKey) => ({
    roleKey,
    threads: inOrder.filter((thread) => thread.roleKey === roleKey),
  }));
}

/** The person with the newest Thread, where the conversation stands; with none yet, the CTO. */
export function firstInitiativeTab(tabs: readonly InitiativeTab[]): string | undefined {
  const newest = threadsInOrder(tabs.flatMap(({ threads }) => threads)).at(-1);
  return newest?.roleKey ?? tabs[0]?.roleKey;
}

/** The person's tab the address names, by their key or by any of their Threads, as `tabAsked`. */
export function initiativeTabAsked(
  initiativeThread: string | undefined,
  tabs: readonly InitiativeTab[],
): string | undefined {
  if (initiativeThread === undefined) return undefined;
  return tabs.find(
    ({ roleKey, threads }) =>
      roleKey === initiativeThread || threads.some(({ id }) => id === initiativeThread),
  )?.roleKey;
}

/** The Thread the address names, when it names one of the tab's rather than the person. */
export function threadAsked(
  initiativeThread: string | undefined,
  tab: InitiativeTab,
): string | undefined {
  return tab.threads.find(({ id }) => id === initiativeThread)?.id;
}

/** Under the person's name: what they do on the Initiative. */
export function initiativeTabLine(roleKey: string): string {
  if (roleKey === CTO_ROLE_KEY) return "Shapes the outcome and the Tasks with you";
  if (roleKey === PLANNER_ROLE_KEY) return "Plans the Initiative's Tasks";
  return "Talks with you on this Initiative";
}

/** The name a tab shows while nobody fills its Role, as the CTO's and the Planner's always show. */
export function unfilledRoleName(roleKey: string): string {
  if (roleKey === CTO_ROLE_KEY) return "CTO";
  if (roleKey === PLANNER_ROLE_KEY) return "Planner";
  return roleKey;
}

/** What a tab with no Thread says; `personName` is undefined while nobody fills the Role. */
export function emptyInitiativeTabWords({
  roleKey,
  personName,
  initiativeName,
  ended,
}: {
  readonly roleKey: string;
  readonly personName: string | undefined;
  readonly initiativeName: string;
  readonly ended: boolean;
}): string {
  if (ended) {
    return `No conversation with ${personName ?? unfilledRoleName(roleKey)} on ${initiativeName}.`;
  }
  if (roleKey === CTO_ROLE_KEY) {
    return personName === undefined
      ? `No conversation on ${initiativeName} yet. Hire a CTO to shape it with them.`
      : `No conversation with ${personName} on ${initiativeName} yet.`;
  }
  if (roleKey === PLANNER_ROLE_KEY) {
    return personName === undefined
      ? `No planning on ${initiativeName} yet. Hire a Planner to plan its Tasks.`
      : `No planning on ${initiativeName} yet. Once it is active with a Task in Backlog, Plan the Initiative starts it with ${personName}.`;
  }
  return `No conversation with ${personName ?? roleKey} on ${initiativeName} yet.`;
}

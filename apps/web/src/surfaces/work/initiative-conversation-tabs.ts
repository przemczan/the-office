import type { Thread } from "@the-office/contracts";
import type { DutyHolder } from "../../shell/use-duty-holder.ts";
import { threadsInOrder } from "./timeline-words.ts";

/** The duties an Initiative's conversation is pinned to, shaping first as it comes first. */
export type InitiativeDuty = "shapes-initiatives" | "plans";

/** A person's tab in an Initiative's conversation, or a duty's while nobody holds it. */
export interface InitiativeTab {
  /** The person's Role key; for a duty nobody holds, the duty's key. */
  readonly roleKey: string;
  /** The duties the tab is pinned for, shaping first; none for anyone else with a Thread here. */
  readonly duties: readonly InitiativeDuty[];
  /** The duty's label as the tab's name while nobody holds it; undefined on a person's tab. */
  readonly unheldLabel: string | undefined;
  /** Their Threads on the Initiative, the oldest first; the composer writes to the newest. */
  readonly threads: readonly Thread[];
}

/** Who holds the duties an Initiative's conversation is pinned to. */
export interface InitiativeHolders {
  readonly shaper: DutyHolder;
  readonly planner: DutyHolder;
}

/**
 * The tabs of whoever holds Shapes Initiatives and Plans, one when one person holds both, or the
 * duty's own while nobody holds it; then anyone else's with a Thread here, in the order they
 * joined. Threads stay with the person who had them, so a former holder keeps their own tab.
 */
export function initiativeTabs(
  threads: readonly Thread[],
  { shaper, planner }: InitiativeHolders,
): InitiativeTab[] {
  const inOrder = threadsInOrder(threads);
  const threadsOf = (roleKey: string): readonly Thread[] =>
    inOrder.filter((thread) => thread.roleKey === roleKey);
  const pinned = pinnedTabs([
    ["shapes-initiatives", shaper],
    ["plans", planner],
  ]);
  const others = [...new Set(inOrder.map(({ roleKey }) => roleKey))].filter(
    (roleKey) => !pinned.some((tab) => tab.roleKey === roleKey),
  );
  return [
    ...pinned.map((tab) => ({ ...tab, threads: threadsOf(tab.roleKey) })),
    ...others.map((roleKey) => ({
      roleKey,
      duties: [],
      unheldLabel: undefined,
      threads: threadsOf(roleKey),
    })),
  ];
}

function pinnedTabs(
  holders: readonly (readonly [InitiativeDuty, DutyHolder])[],
): Omit<InitiativeTab, "threads">[] {
  const tabs: Omit<InitiativeTab, "threads">[] = [];
  for (const [duty, { holder, label }] of holders) {
    const roleKey = holder?.key ?? duty;
    const same = tabs.find((tab) => tab.roleKey === roleKey);
    if (same) {
      tabs[tabs.indexOf(same)] = { ...same, duties: [...same.duties, duty] };
    } else {
      tabs.push({ roleKey, duties: [duty], unheldLabel: holder ? undefined : label });
    }
  }
  return tabs;
}

/**
 * The person with the newest Thread, where the conversation stands; with none yet, the first tab.
 */
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

/** Under the person's name: what they do on the Initiative, by the duties the tab is pinned for. */
export function initiativeTabLine({ duties }: Pick<InitiativeTab, "duties">): string {
  const shapes = duties.includes("shapes-initiatives");
  const plans = duties.includes("plans");
  if (shapes && plans) return "Shapes the outcome and the Tasks with you, and plans them";
  if (shapes) return "Shapes the outcome and the Tasks with you";
  if (plans) return "Plans the Initiative's Tasks";
  return "Talks with you on this Initiative";
}

/** The name a tab shows while nobody fills its Role: the duty's label, else the Role's key. */
export function unfilledTabName({
  roleKey,
  unheldLabel,
}: Pick<InitiativeTab, "roleKey" | "unheldLabel">): string {
  return unheldLabel ?? roleKey;
}

/** What a tab with no Thread says; `personName` is undefined while nobody fills the Role. */
export function emptyInitiativeTabWords({
  tab,
  personName,
  initiativeName,
  ended,
}: {
  readonly tab: Pick<InitiativeTab, "roleKey" | "duties" | "unheldLabel">;
  readonly personName: string | undefined;
  readonly initiativeName: string;
  readonly ended: boolean;
}): string {
  const name = personName ?? unfilledTabName(tab);
  if (ended) return `No conversation with ${name} on ${initiativeName}.`;
  const [duty] = tab.duties;
  if (duty === "shapes-initiatives") {
    return tab.unheldLabel === undefined
      ? `No conversation with ${name} on ${initiativeName} yet.`
      : `No conversation on ${initiativeName} yet: nobody holds ${tab.unheldLabel}.`;
  }
  if (duty === "plans") {
    return tab.unheldLabel === undefined
      ? `No planning on ${initiativeName} yet. Once it is active with a Task in Backlog, Plan the Initiative starts it with ${name}.`
      : `No planning on ${initiativeName} yet: nobody holds ${tab.unheldLabel}.`;
  }
  return `No conversation with ${name} on ${initiativeName} yet.`;
}

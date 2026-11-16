import { useQuery } from "@tanstack/react-query";
import type { NeedsYouItem } from "@the-office/contracts";
import { useEffect, useState } from "react";
import { nowQueries } from "../../api/notifications.ts";
import { useTabVisible } from "../use-tab-visible.ts";
import { blinkingTabTitle, tabTitle } from "./notification-words.ts";

const SIZE = 64;
const BLINK_MS = 1000;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Needs you, where a tab in the background shows it: counted in the tab's title and as a badge on
 * the favicon, across every Project, since the Project filter never silences it (spec §2.7). A new
 * item arriving while the tab is hidden makes the tab blink until the user looks.
 */
export function useNeedsYouTab(): void {
  const needsYou = useQuery(nowQueries.now()).data?.needsYou;
  const count = needsYou?.length ?? 0;
  const blinking = useBlinking(needsYou);
  const showsCount = useBlinkPhase(blinking);

  useEffect(() => {
    document.title = showsCount ? tabTitle(count) : blinkingTabTitle(count);
    let current = true;
    const link = iconLink();
    const showBadge = async (): Promise<void> => {
      const favicon = link.dataset["favicon"] ?? link.href;
      const href = showsCount ? await badgedFavicon(favicon, count) : favicon;
      if (current) link.href = href;
    };
    void showBadge();
    return () => {
      current = false;
    };
  }, [count, showsCount]);
}

/**
 * Whether the tab blinks: while it is hidden and holds an item the user hasn't seen, one that
 * arrived since the tab last showed. Those there when the page loads count as seen, and with
 * reduced motion preferred nothing blinks.
 */
function useBlinking(needsYou: readonly NeedsYouItem[] | undefined): boolean {
  const visible = useTabVisible();
  const [seen, setSeen] = useState<ReadonlySet<string> | undefined>(undefined);
  const waiting = needsYou && new Set(needsYou.map(itemKey));
  if (waiting && (seen === undefined || (visible && !sameItems(seen, waiting)))) {
    setSeen(waiting);
  }
  return !visible && !!waiting && !!seen && hasNew(waiting, seen) && !reducedMotion();
}

/** Each second between the count and the blink's other look while blinking; the count otherwise. */
function useBlinkPhase(blinking: boolean): boolean {
  const [showsCount, setShowsCount] = useState(true);
  useEffect(() => {
    if (!blinking) return;
    const timer = window.setInterval(() => setShowsCount((shown) => !shown), BLINK_MS);
    return () => {
      window.clearInterval(timer);
      setShowsCount(true);
    };
  }, [blinking]);
  return !blinking || showsCount;
}

function itemKey(item: NeedsYouItem): string {
  switch (item.kind) {
    case "decision":
    case "initiative-decision":
      return `decision:${item.decisionId}`;
    case "gate":
      return `gate:${item.taskId}:${item.stageKey}:${item.waitingSince}`;
  }
}

function hasNew(waiting: ReadonlySet<string>, seen: ReadonlySet<string>): boolean {
  return [...waiting].some((key) => !seen.has(key));
}

function sameItems(seen: ReadonlySet<string>, waiting: ReadonlySet<string>): boolean {
  return seen.size === waiting.size && !hasNew(waiting, seen);
}

function reducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION).matches;
}

/**
 * The favicon the design system's Vite plugin links, keeping its own address beside the one shown,
 * so each badge is drawn over the plain favicon.
 */
function iconLink(): HTMLLinkElement {
  const link =
    document.querySelector<HTMLLinkElement>("link[rel='icon']") ?? document.createElement("link");
  if (!link.isConnected) {
    link.rel = "icon";
    document.head.append(link);
  }
  link.dataset["favicon"] ??= link.href;
  return link;
}

/**
 * Each count's badge, drawn once in each appearance's colours, so a blinking tab doesn't redraw it
 * every second.
 */
const badges = new Map<string, Promise<string>>();

function badgedFavicon(favicon: string, count: number): Promise<string> {
  const key = [favicon, badgeText(count), token("--danger"), token("--fg-on-accent")].join(" ");
  let badge = badges.get(key);
  if (!badge) {
    badge = faviconWith(favicon, count);
    badges.set(key, badge);
    void forgetIfPlain(key, badge, favicon);
  }
  return badge;
}

/** A favicon that couldn't be drawn is tried again next time, not kept plain for good. */
async function forgetIfPlain(key: string, badge: Promise<string>, favicon: string): Promise<void> {
  if ((await badge) === favicon) badges.delete(key);
}

/** The favicon itself while nothing waits; drawn with the count in a dot otherwise. */
async function faviconWith(favicon: string, count: number): Promise<string> {
  if (count === 0) return favicon;
  const image = new Image();
  image.src = favicon;
  // A favicon that can't be drawn stays as it is; the title still counts.
  const decoded = await image.decode().then(
    () => true,
    () => false,
  );
  if (!decoded) return favicon;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) return favicon;
  context.drawImage(image, 0, 0, SIZE, SIZE);
  const radius = SIZE * 0.3;
  context.beginPath();
  context.arc(SIZE - radius, radius, radius, 0, Math.PI * 2);
  context.fillStyle = token("--danger");
  context.fill();
  context.fillStyle = token("--fg-on-accent");
  context.font = `bold ${Math.round(radius * 1.3)}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(badgeText(count), SIZE - radius, radius + 1);
  return canvas.toDataURL("image/png");
}

function badgeText(count: number): string {
  return count > 9 ? "9+" : String(count);
}

/** A colour token's value as the page resolves it: a canvas takes no CSS variables. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

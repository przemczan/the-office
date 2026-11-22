import { useCallback, useEffect, useEffectEvent, useRef, useSyncExternalStore } from "react";
import { markActivitySeen } from "../../api/activity.ts";
import { useTabVisible } from "../../shell/use-tab-visible.ts";

/** How long a card is in view before its item counts as seen. */
export const SEEN_AFTER_MS = 1000;
/** At most one `POST /activity/seen` this often; the ids seen meanwhile wait for the next. */
export const SEND_EVERY_MS = 1000;
/** How much of a card must be in view. */
const IN_VIEW_SHARE = 0.5;
/** The most ids `POST /activity/seen` takes at once. */
const MOST_IDS_SENT = 500;

/**
 * Watches the cards of the ended items not yet seen: one is seen once at least half of it has been
 * in view for `SEEN_AFTER_MS` while the tab shows and the window has focus. The page hears of each
 * at once; the service in batches, one send a `SEND_EVERY_MS` at most, a failed one tried again
 * with the next. Answers the ref to give the card of item `itemId`.
 */
export function useMarkingSeen(
  onSeen: (itemId: string) => void,
): (itemId: string) => (card: HTMLElement | null) => void {
  const tabVisible = useTabVisible();
  const windowFocused = useWindowFocused();
  const attentive = tabVisible && windowFocused;
  const reportSeen = useEffectEvent(onSeen);
  const watcher = useRef<SeenWatcher | null>(null);
  // The cards shown, by item: refs are set before effects run, so the watcher starts on these.
  const cards = useRef(new Map<string, HTMLElement>());
  // Each item keeps one ref, so a re-render never stops and restarts its card's watch.
  const refs = useRef(new Map<string, (card: HTMLElement | null) => void>());

  useEffect(() => {
    const created = new SeenWatcher((itemId) => reportSeen(itemId), markActivitySeen);
    for (const [itemId, card] of cards.current) created.watch(card, itemId);
    watcher.current = created;
    return () => {
      created.dispose();
      watcher.current = null;
    };
  }, []);

  useEffect(() => watcher.current?.setAttentive(attentive), [attentive]);

  return useCallback((itemId) => {
    let ref = refs.current.get(itemId);
    if (ref === undefined) {
      ref = (card) => {
        const watched = cards.current.get(itemId);
        if (watched) watcher.current?.unwatch(watched);
        if (card) {
          cards.current.set(itemId, card);
          watcher.current?.watch(card, itemId);
        } else {
          cards.current.delete(itemId);
        }
      };
      refs.current.set(itemId, ref);
    }
    return ref;
  }, []);
}

/**
 * What `useMarkingSeen` keeps apart from React: the observer, a timer per card in view and the
 * ids waiting to be sent.
 */
export class SeenWatcher {
  private readonly observer: IntersectionObserver;
  private readonly itemIds = new Map<Element, string>();
  private readonly inView = new Set<Element>();
  private readonly timers = new Map<Element, ReturnType<typeof setTimeout>>();
  private readonly seen = new Set<string>();
  private readonly waiting = new Set<string>();
  private attentive = false;
  private disposed = false;
  private sending = false;
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private sendTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly reportSeen: (itemId: string) => void,
    private readonly send: (itemIds: readonly string[]) => Promise<void>,
  ) {
    this.observer = new IntersectionObserver((entries) => this.viewChanged(entries), {
      threshold: IN_VIEW_SHARE,
    });
  }

  watch(card: Element, itemId: string): void {
    if (this.seen.has(itemId)) return;
    this.itemIds.set(card, itemId);
    this.observer.observe(card);
  }

  unwatch(card: Element): void {
    this.observer.unobserve(card);
    this.stopTimer(card);
    this.inView.delete(card);
    this.itemIds.delete(card);
  }

  setAttentive(attentive: boolean): void {
    this.attentive = attentive;
    for (const card of this.inView) {
      if (attentive) this.startTimer(card);
      else this.stopTimer(card);
    }
  }

  /** Stops watching; what is waiting is sent at once, as the page is going. */
  dispose(): void {
    this.disposed = true;
    this.observer.disconnect();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    clearTimeout(this.sendTimer);
    if (this.waiting.size > 0) void this.send([...this.waiting].slice(0, MOST_IDS_SENT));
  }

  private viewChanged(entries: readonly IntersectionObserverEntry[]): void {
    for (const { target, isIntersecting, intersectionRatio } of entries) {
      if (isIntersecting && intersectionRatio >= IN_VIEW_SHARE) {
        this.inView.add(target);
        if (this.attentive) this.startTimer(target);
      } else {
        this.inView.delete(target);
        this.stopTimer(target);
      }
    }
  }

  private startTimer(card: Element): void {
    if (this.timers.has(card)) return;
    const timer = setTimeout(() => {
      this.timers.delete(card);
      const itemId = this.itemIds.get(card);
      if (itemId !== undefined) this.markSeen(itemId, card);
    }, SEEN_AFTER_MS);
    this.timers.set(card, timer);
  }

  private stopTimer(card: Element): void {
    clearTimeout(this.timers.get(card));
    this.timers.delete(card);
  }

  private markSeen(itemId: string, card: Element): void {
    this.unwatch(card);
    if (this.seen.has(itemId)) return;
    this.seen.add(itemId);
    this.waiting.add(itemId);
    this.reportSeen(itemId);
    this.scheduleSend();
  }

  private scheduleSend(): void {
    if (this.disposed || this.sendTimer !== undefined || this.sending || this.waiting.size === 0) {
      return;
    }
    const wait = Math.max(0, this.lastSentAt + SEND_EVERY_MS - Date.now());
    this.sendTimer = setTimeout(() => {
      this.sendTimer = undefined;
      void this.sendWaiting();
    }, wait);
  }

  private async sendWaiting(): Promise<void> {
    const itemIds = [...this.waiting].slice(0, MOST_IDS_SENT);
    for (const itemId of itemIds) this.waiting.delete(itemId);
    this.sending = true;
    this.lastSentAt = Date.now();
    try {
      await this.send(itemIds);
    } catch {
      for (const itemId of itemIds) this.waiting.add(itemId);
    } finally {
      this.sending = false;
      this.scheduleSend();
    }
  }
}

/** Whether the browser window has focus, so what shows in it is being looked at. */
function useWindowFocused(): boolean {
  return useSyncExternalStore(subscribeToFocus, () => document.hasFocus());
}

function subscribeToFocus(changed: () => void): () => void {
  window.addEventListener("focus", changed);
  window.addEventListener("blur", changed);
  return () => {
    window.removeEventListener("focus", changed);
    window.removeEventListener("blur", changed);
  };
}

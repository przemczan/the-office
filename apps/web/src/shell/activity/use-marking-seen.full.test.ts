import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEEN_AFTER_MS, SEND_EVERY_MS, SeenWatcher } from "./use-marking-seen.ts";

/** The one IntersectionObserver the watcher made, to say which cards are in view. */
let viewChanged: IntersectionObserverCallback;

class StubObserver {
  constructor(callback: IntersectionObserverCallback) {
    viewChanged = callback;
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function inView(card: Element, ratio = 1): void {
  viewChanged(
    [{ target: card, isIntersecting: ratio > 0, intersectionRatio: ratio } as never],
    {} as IntersectionObserver,
  );
}

let sent: (readonly string[])[];
let seen: string[];
let send: (itemIds: readonly string[]) => Promise<void>;

function watcher(): SeenWatcher {
  return new SeenWatcher(
    (itemId) => seen.push(itemId),
    (itemIds) => send(itemIds),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IntersectionObserver", StubObserver);
  sent = [];
  seen = [];
  send = async (itemIds) => {
    sent.push(itemIds);
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("marking Activity's ended items seen", () => {
  it("counts a card seen after a second in view while attentive, and sends the seen in one batch", async () => {
    const watching = watcher();
    watching.setAttentive(true);
    const first = document.createElement("article");
    const second = document.createElement("article");
    watching.watch(first, "a");
    watching.watch(second, "b");

    inView(first);
    inView(second, 0.6);
    await vi.advanceTimersByTimeAsync(SEEN_AFTER_MS - 1);
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(seen).toEqual(["a", "b"]);
    // The send waits for the end of the moment, so what was seen in it goes together.
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toEqual([["a", "b"]]);
    await vi.advanceTimersByTimeAsync(5 * SEND_EVERY_MS);
    expect(sent).toHaveLength(1);
  });

  it("sends nothing while the tab is hidden or the window has no focus, or the card is mostly out of view", async () => {
    const watching = watcher();
    const card = document.createElement("article");
    const half = document.createElement("article");
    watching.watch(card, "a");
    watching.watch(half, "b");

    inView(card);
    inView(half, 0.3);
    await vi.advanceTimersByTimeAsync(3 * SEEN_AFTER_MS);
    expect(seen).toEqual([]);

    watching.setAttentive(true);
    await vi.advanceTimersByTimeAsync(SEEN_AFTER_MS / 2);
    watching.setAttentive(false);
    await vi.advanceTimersByTimeAsync(3 * SEEN_AFTER_MS);

    expect(seen).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("forgets a card that leaves the view before its second is up", async () => {
    const watching = watcher();
    watching.setAttentive(true);
    const card = document.createElement("article");
    watching.watch(card, "a");

    inView(card);
    await vi.advanceTimersByTimeAsync(SEEN_AFTER_MS / 2);
    inView(card, 0);
    await vi.advanceTimersByTimeAsync(3 * SEEN_AFTER_MS);

    expect(seen).toEqual([]);
  });

  it("sends at most once a second, and tries a failed send again with the next", async () => {
    let fails = true;
    send = async (itemIds) => {
      sent.push(itemIds);
      if (fails) throw new Error("The service is away.");
    };
    const watching = watcher();
    watching.setAttentive(true);
    const first = document.createElement("article");
    const second = document.createElement("article");
    watching.watch(first, "a");
    watching.watch(second, "b");

    inView(first);
    await vi.advanceTimersByTimeAsync(SEEN_AFTER_MS / 2);
    inView(second);
    await vi.advanceTimersByTimeAsync(SEEN_AFTER_MS / 2 + 1);
    expect(sent).toEqual([["a"]]);
    fails = false;
    await vi.advanceTimersByTimeAsync(SEND_EVERY_MS - 1);
    expect(seen).toEqual(["a", "b"]);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(sent).toEqual([["a"], ["a", "b"]]);
  });
});

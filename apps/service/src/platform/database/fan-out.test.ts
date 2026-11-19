import { describe, expect, it, vi } from "vitest";
import { onceByKey, READS_AT_ONCE, readEach } from "./fan-out.js";

/** A read of each item that answers on the next turn of the event loop, counting the most at once. */
function countedReads() {
  let running = 0;
  let mostAtOnce = 0;
  const read = vi.fn<(item: number) => Promise<number>>(async (item) => {
    running += 1;
    mostAtOnce = Math.max(mostAtOnce, running);
    await new Promise((resolve) => setImmediate(resolve));
    running -= 1;
    return item * 10;
  });
  return { read, mostAtOnce: () => mostAtOnce };
}

function itemsUpTo(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

function answerAsIs(item: number): Promise<number> {
  return Promise.resolve(item);
}

describe("readEach", () => {
  it("reads each item, at most so many at once, answering in the items' order", async () => {
    const { read, mostAtOnce } = countedReads();
    const items = itemsUpTo(11);

    const answers = await readEach(items, read, 3);

    expect(answers).toEqual(items.map((item) => item * 10));
    expect(read).toHaveBeenCalledTimes(11);
    expect(mostAtOnce()).toBe(3);
  });

  it("reads at most READS_AT_ONCE at once unless told otherwise, well under the pool's 10", async () => {
    const { read, mostAtOnce } = countedReads();

    await readEach(itemsUpTo(20), read);

    expect(mostAtOnce()).toBe(READS_AT_ONCE);
    expect(READS_AT_ONCE).toBeLessThan(10);
  });

  it("answers none for no items, reading nothing", async () => {
    const read = vi.fn<(item: number) => Promise<number>>(answerAsIs);

    expect(await readEach([], read)).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects with the first failure and starts no item after it", async () => {
    const read = vi.fn<(item: number) => Promise<number>>((item) =>
      item === 1 ? Promise.reject(new Error("connection lost")) : Promise.resolve(item),
    );

    await expect(readEach(itemsUpTo(5), read, 1)).rejects.toThrow("connection lost");
    expect(read.mock.calls.map(([item]) => item)).toEqual([0, 1]);
  });

  it("refuses a number of reads at once that isn't a whole number from 1", async () => {
    await expect(readEach([1], answerAsIs, 0)).rejects.toThrow(RangeError);
    await expect(readEach([1], answerAsIs, 1.5)).rejects.toThrow(RangeError);
  });
});

describe("onceByKey", () => {
  it("reads once per key, asks at the same time sharing one read", async () => {
    const read = vi.fn<(roleKey: string) => Promise<string>>((roleKey) =>
      Promise.resolve(`card of ${roleKey}`),
    );
    const cardOf = onceByKey(read);

    const answers = await Promise.all([
      cardOf("developer"),
      cardOf("developer"),
      cardOf("reviewer"),
    ]);

    expect(answers).toEqual(["card of developer", "card of developer", "card of reviewer"]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keys a read by its whole argument unless told how", async () => {
    const read = vi.fn<(place: { roleKey: string; projectId: string }) => Promise<string>>(
      ({ roleKey }) => Promise.resolve(roleKey),
    );
    const byWhole = onceByKey(read);
    const byRole = onceByKey(read, ({ roleKey }) => roleKey);

    await byWhole({ roleKey: "developer", projectId: "admin" });
    await byWhole({ roleKey: "developer", projectId: "shop" });
    await byRole({ roleKey: "developer", projectId: "admin" });
    await byRole({ roleKey: "developer", projectId: "shop" });

    expect(read).toHaveBeenCalledTimes(3);
  });

  it("reads again after a read that failed", async () => {
    const read = vi
      .fn<(key: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValue("row");
    const rowOf = onceByKey(read);

    await expect(rowOf("settings")).rejects.toThrow("connection lost");
    await expect(rowOf("settings")).resolves.toBe("row");
    await expect(rowOf("settings")).resolves.toBe("row");
    expect(read).toHaveBeenCalledTimes(2);
  });
});

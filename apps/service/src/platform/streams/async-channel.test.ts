import { describe, expect, it } from "vitest";
import { AsyncChannel } from "./async-channel.js";

async function readAll<T>(channel: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of channel) items.push(item);
  return items;
}

describe("AsyncChannel", () => {
  it("gives the reader what was pushed before and while it reads, then finishes once closed", async () => {
    const channel = new AsyncChannel<number>();
    channel.push(1);
    const reading = readAll(channel);
    channel.push(2);
    await Promise.resolve();
    channel.push(3);
    channel.close();

    await expect(reading).resolves.toEqual([1, 2, 3]);
  });

  it("throws to the reader once failed, after what was buffered", async () => {
    const channel = new AsyncChannel<number>();
    const items: number[] = [];
    channel.push(1);
    channel.fail(new Error("engine down"));

    const reading = (async () => {
      for await (const item of channel) items.push(item);
    })();

    await expect(reading).rejects.toThrow("engine down");
    expect(items).toEqual([1]);
  });

  it("refuses a push once closed, and keeps the first ending", async () => {
    const channel = new AsyncChannel<number>();
    channel.close();
    channel.fail(new Error("too late"));

    expect(() => channel.push(1)).toThrow("The channel is closed.");
    await expect(readAll(channel)).resolves.toEqual([]);
  });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { InputChannel } from "./input-channel.ts";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

test("yields items pushed before and while iterating, then ends on close", async () => {
  const channel = new InputChannel<number>();
  channel.push(1);
  const collected = collect(channel);
  await Promise.resolve();
  channel.push(2);
  channel.close();
  assert.deepEqual(await collected, [1, 2]);
});

test("refuses pushes after close", () => {
  const channel = new InputChannel<number>();
  channel.close();
  assert.throws(() => channel.push(1));
});

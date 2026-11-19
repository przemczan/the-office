/**
 * How many of one fan-out's reads run at once. The pool holds node-postgres' default of 10
 * connections, and a request reading something for each of many records must leave most of them to
 * every other request, or those wait seconds for one list.
 */
export const READS_AT_ONCE = 4;

/**
 * `read` for each of `items`, at most `atOnce` at a time, answered in `items`' order. The first
 * failure rejects it, and no item starts after it.
 */
export async function readEach<Item, Result>(
  items: readonly Item[],
  read: (item: Item) => Promise<Result>,
  atOnce: number = READS_AT_ONCE,
): Promise<Result[]> {
  if (!Number.isInteger(atOnce) || atOnce < 1) {
    throw new RangeError(`Reads run at once in a whole number from 1, not ${atOnce}.`);
  }
  const results: Result[] = [];
  let next = 0;
  let failed = false;
  const readInTurn = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await read(items[index] as Item);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(atOnce, items.length) }, readInTurn));
  return results;
}

/**
 * `read` asked once per key, by `keyOf`, for as long as the answered function is kept: what one
 * list's items share, read once for the list. The promise is kept, so asks at the same time share
 * one read; a failed read is asked again.
 */
export function onceByKey<Key, Result>(
  read: (key: Key) => Promise<Result>,
  keyOf: (key: Key) => string = (key) => JSON.stringify(key),
): (key: Key) => Promise<Result> {
  const kept = new Map<string, Promise<Result>>();
  return (key) => {
    const name = keyOf(key);
    const keptRead = kept.get(name);
    if (keptRead) return keptRead;
    const reading = read(key);
    kept.set(name, reading);
    reading.catch(() => {
      if (kept.get(name) === reading) kept.delete(name);
    });
    return reading;
  };
}

/**
 * A held call's input in one form (spec §6), so the same call made again after "Allow once" reads
 * the same and finds its approval, though its keys come in another order or its words are spaced
 * otherwise: every object's keys in alphabetical order, each text trimmed with its runs of white
 * space made one space, arrays in the order given, and what was left out (undefined) dropped.
 */
export function canonicalCall(input: unknown): string {
  return JSON.stringify(canonical(input));
}

function canonical(value: unknown): unknown {
  if (typeof value === "string") return value.trim().replace(/\s+/g, " ");
  if (Array.isArray(value)) return value.map((item: unknown) => canonical(item) ?? null);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, each]) => each !== undefined)
        .toSorted(([one], [other]) => (one < other ? -1 : one > other ? 1 : 0))
        .map(([key, each]) => [key, canonical(each)]),
    );
  }
  return value;
}

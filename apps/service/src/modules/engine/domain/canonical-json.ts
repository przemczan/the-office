import { createHash } from "node:crypto";

/** JSON with every object's keys sorted and no whitespace, so equal values read equal. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortedKeys(value));
}

function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, each]) => each !== undefined)
      .toSorted(([first], [second]) => (first < second ? -1 : first > second ? 1 : 0))
      .map(([key, each]) => [key, sortedKeys(each)]),
  );
}

/**
 * The fingerprint of what an Office action's handler reads and writes: a hash of its canonical JSON,
 * so equal values give one fingerprint whatever the order of their keys.
 */
export function fingerprintOf(source: unknown): string {
  return createHash("sha256").update(canonicalJson(source)).digest("hex");
}

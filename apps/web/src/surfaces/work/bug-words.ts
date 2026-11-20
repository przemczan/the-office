/** Found in version's words at most, as the service takes them. */
export const FOUND_IN_VERSION_MAX = 64;

/**
 * The tags Found in version offers: a Project's release tags, those matching v*, newest first by
 * their version's numbers.
 */
export function foundInVersionTags(tags: readonly string[]): string[] {
  return tags.filter((tag) => tag.startsWith("v")).toSorted(newestVersionFirst);
}

/** A tag's version numbers, "v1.14.2" as 1, 14 and 2; a part that isn't a number is NaN. */
function numbersOf(tag: string): number[] {
  return tag
    .slice(1)
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10));
}

function newestVersionFirst(one: string, other: string): number {
  const ones = numbersOf(one);
  const others = numbersOf(other);
  for (let index = 0; index < Math.max(ones.length, others.length); index += 1) {
    const a = ones[index] ?? -1;
    const b = others[index] ?? -1;
    const difference = (Number.isNaN(b) ? -1 : b) - (Number.isNaN(a) ? -1 : a);
    if (difference !== 0) return difference;
  }
  return other.localeCompare(one);
}

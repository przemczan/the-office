/**
 * Why a session's skill listing is not what it must be (spec §5.6), naming every skill missing
 * from it and every skill in it that isn't the session's; empty when they are the same.
 */
export function listingProblems(expected: readonly string[], listed: readonly string[]): string[] {
  const listedNames = new Set(listed);
  const expectedNames = new Set(expected);
  const missing = [...expectedNames].filter((name) => !listedNames.has(name)).toSorted();
  const extra = [...listedNames].filter((name) => !expectedNames.has(name)).toSorted();
  return [
    ...(missing.length > 0 ? [`It doesn't list ${missing.join(", ")}.`] : []),
    ...(extra.length > 0 ? [`It lists ${extra.join(", ")}, which it shouldn't have.`] : []),
  ];
}

/** Names as an observation records them: each once, sorted, so the order of events never shows. */
export function sortedNames(names: Iterable<string>): string[] {
  return [...new Set(names)].sort();
}

/**
 * The lines of `before` and `after` as one hunk of a unified diff (what `diffLines` reads): the
 * lines both share as context, the others removed or added, found by the longest common run.
 */
export function textDiff(before: string, after: string): string {
  const was = before === "" ? [] : before.split("\n");
  const now = after === "" ? [] : after.split("\n");
  const common = commonLengths(was, now);
  const lines: string[] = [];
  let i = 0;
  let j = 0;
  while (i < was.length || j < now.length) {
    if (i < was.length && j < now.length && was[i] === now[j]) {
      lines.push(` ${was[i]}`);
      i += 1;
      j += 1;
    } else if (j >= now.length || (i < was.length && common[i + 1]![j]! >= common[i]![j + 1]!)) {
      lines.push(`-${was[i]}`);
      i += 1;
    } else {
      lines.push(`+${now[j]}`);
      j += 1;
    }
  }
  return `@@ @@\n${lines.join("\n")}\n`;
}

/** `common[i][j]`: how many lines the tails `was[i..]` and `now[j..]` share, in order. */
function commonLengths(was: readonly string[], now: readonly string[]): number[][] {
  const common = Array.from({ length: was.length + 1 }, () =>
    Array.from({ length: now.length + 1 }, () => 0),
  );
  for (let i = was.length - 1; i >= 0; i -= 1) {
    for (let j = now.length - 1; j >= 0; j -= 1) {
      common[i]![j] =
        was[i] === now[j]
          ? common[i + 1]![j + 1]! + 1
          : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
    }
  }
  return common;
}

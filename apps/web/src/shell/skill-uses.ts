/** A skill's Skill uses in the last 7 days, in full, as both lists of skills say it. */
export function skillUsesLabel(count: number): string {
  if (count === 0) return "Not used in the last 7 days";
  if (count === 1) return "Used once in the last 7 days";
  return `Used ${count} times in the last 7 days`;
}

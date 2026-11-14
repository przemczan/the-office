import type { Duty, DutyKey } from "@the-office/contracts";

/**
 * Each duty as the spec names it (§2.2), so a Stage naming one reads well before the duties are
 * read, and a stored Stage keeps its words whatever the list holds.
 */
export const DUTY_LABELS: Readonly<Record<DutyKey, string>> = {
  "default-person-to-talk-to": "Default person to talk to",
  "shapes-initiatives": "Shapes Initiatives",
  "asked-first-when-out-of-tries": "Asked first when a Stage runs out of tries",
  "onboards-projects": "Onboards and repairs Projects",
  "mcp-tool-consultant": "Default Consultant for MCP tool hard switches",
  plans: "Plans",
  implements: "Implements",
  reviews: "Reviews",
};

/** The duties an Agent Stage may name, in the order "Who works it" offers them. */
export const STAGE_DUTIES: readonly DutyKey[] = [
  "plans",
  "implements",
  "reviews",
  "onboards-projects",
];

/** The duty's holder, while someone holds it. */
export function dutyHolder(
  duty: DutyKey,
  duties: readonly Duty[],
): NonNullable<Duty["holder"]> | undefined {
  return duties.find(({ key }) => key === duty)?.holder ?? undefined;
}

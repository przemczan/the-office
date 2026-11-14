import type { Duty, DutyFallback, DutyKey, Role } from "@the-office/contracts";
import { personName } from "./person-name.ts";

/** What each duty is, in a line, and what happens while nobody holds it (spec §2.2, "Duties"). */
const DUTY_WORDS: Readonly<
  Record<DutyKey, { readonly description: string; readonly fallback: DutyFallback }>
> = {
  "default-person-to-talk-to": {
    description:
      "The Chat button opens with them while no Thread is open, and they draft changes to Office settings.",
    fallback: "caretaker",
  },
  "shapes-initiatives": {
    description: "Shapes Ideas into Initiatives with you and splits them into Tasks.",
    fallback: "user",
  },
  "asked-first-when-out-of-tries": {
    description: "Consulted first when a Stage fails after its last try.",
    fallback: "user",
  },
  "onboards-projects": {
    description:
      "Onboards and repairs Projects, and owns the Pipeline library, Project commands and Skill installs.",
    fallback: "user",
  },
  "mcp-tool-consultant": {
    description: "Consulted on an MCP tool's call wherever a Role card leaves it unset.",
    fallback: "user",
  },
  plans: { description: "Writes each Task's Plan and Definition of Done.", fallback: "user" },
  implements: {
    description: "Works the Stages that name Implements in a Pipeline.",
    fallback: "unstaffed",
  },
  reviews: {
    description: "Works the Stages that name Reviews in a Pipeline.",
    fallback: "unstaffed",
  },
};

const FALLBACK_WORDS: Readonly<Record<DutyFallback, string>> = {
  caretaker: "The Caretaker is the one to talk to.",
  user: "You do it yourself.",
  unstaffed: "Pipelines whose Stages name it are flagged, and Start is refused.",
};

/** The duties whose holder is passed over while their Consultant is off, so the user is asked. */
const CONSULTANT_DUTIES: ReadonlySet<DutyKey> = new Set([
  "asked-first-when-out-of-tries",
  "mcp-tool-consultant",
]);

/** The word for a duty held by nobody, in a picker and in a change. */
export const NOBODY = "Nobody";

export function dutyDescription(key: DutyKey): string {
  return DUTY_WORDS[key].description;
}

/** What happens while nobody holds the duty keyed `key`. */
export function fallbackWords(key: DutyKey): string {
  return FALLBACK_WORDS[DUTY_WORDS[key].fallback];
}

/** The Roles a duty may go to: hired, never the Caretaker, never someone let go. */
export function holderOptions(
  roles: readonly Role[],
): readonly { readonly value: string; readonly label: string }[] {
  return roles
    .filter(({ builtIn, letGoAt }) => !builtIn && !letGoAt)
    .map((role) => ({ value: role.key, label: personName(role) }));
}

/** The duties the Role keyed `roleKey` holds now, in the duties' order. */
export function dutiesHeldBy(duties: readonly Duty[], roleKey: string): readonly Duty[] {
  return duties.filter(({ holder }) => holder?.roleKey === roleKey);
}

/** Who holds the duty, "Ada · Developer", or Nobody. */
export function holderName({ holder }: Pick<Duty, "holder">): string {
  return holder ? `${holder.name} · ${holder.title}` : NOBODY;
}

/** The person a Role key names in a duty change, "Ada · Developer", or Nobody for none. */
export function holderNameOf(roleKey: string | null, roles: readonly Role[] | undefined): string {
  if (roleKey === null) return NOBODY;
  const role = roles?.find(({ key }) => key === roleKey);
  return role ? personName(role) : roleKey;
}

/**
 * Why a duty the user set to someone is held by nobody: that person was let go. Undefined while the
 * duty is held, set to none, or names a Role never hired.
 */
export function letGoHolderWords(duty: Duty, roles: readonly Role[]): string | undefined {
  if (duty.holder || duty.roleKey === null) return undefined;
  const role = roles.find(({ key }) => key === duty.roleKey);
  if (!role?.letGoAt) return undefined;
  return `${personName(role)} held it and was let go; it goes back to them if they are hired back.`;
}

/** Why the holder is skipped and the user asked: their Consultant is off on a Consultant duty. */
export function passedOverWords(duty: Duty, roles: readonly Role[]): string | undefined {
  if (!duty.holder || !CONSULTANT_DUTIES.has(duty.key)) return undefined;
  const role = roles.find(({ key }) => key === duty.holder?.roleKey);
  if (!role || role.card.capabilities.consultant) return undefined;
  return `${role.card.name}'s Consultant is off, so they are passed over and you are asked.`;
}

/** The labels of the duties keyed `keys`, as listed in `duties`; a key not listed stands for itself. */
export function dutyLabels(keys: readonly DutyKey[], duties: readonly Duty[]): string[] {
  return keys.map((key) => duties.find((duty) => duty.key === key)?.label ?? key);
}

/** "Suits: Shapes Initiatives, Plans.": the duties a preset suits; empty when it suits none. */
export function suitsWords(keys: readonly DutyKey[], duties: readonly Duty[]): string {
  return keys.length === 0 ? "" : `Suits: ${dutyLabels(keys, duties).join(", ")}.`;
}

/** "1 duty", "3 duties": a count for a mark that names each duty on hover. */
export function dutyCountWords(count: number): string {
  return count === 1 ? "1 duty" : `${count} duties`;
}

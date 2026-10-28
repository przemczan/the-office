import type { ProjectMarkColour } from "@the-office/contracts";

/** The install inputs the user typed as one line, separated by commas. */
export function installInputsFrom(line: string): string[] {
  return line
    .split(",")
    .map((input) => input.trim())
    .filter((input) => input !== "");
}

export const MARK_COLOUR_LABELS: Readonly<Record<ProjectMarkColour, string>> = {
  teal: "Teal",
  violet: "Violet",
  gray: "Gray",
  ink: "Ink",
};

/** Up to three letters or digits from the name's words, as a mark's label: "Admin panel" → "AP". */
export function markLabelFor(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const initials =
    words.length > 1 ? words.map((word) => word[0]).join("") : (words[0]?.slice(0, 2) ?? "");
  return initials.slice(0, 3).toUpperCase();
}

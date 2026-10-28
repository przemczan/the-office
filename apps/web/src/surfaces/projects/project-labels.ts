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

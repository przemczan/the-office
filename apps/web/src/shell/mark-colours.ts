import type { CustomMarkColour } from "@the-office/contracts";

/** The luminance at which the dark label and the white one read equally well. */
const EVEN_CONTRAST_LUMINANCE = 0.18;

/** The token of the label that reads best on a custom colour. */
export function markLabelColour(colour: CustomMarkColour): string {
  return luminanceOf(colour) > EVEN_CONTRAST_LUMINANCE ? "var(--gray-950)" : "var(--white)";
}

/** WCAG's relative luminance, from 0 for black to 1 for white. */
function luminanceOf(colour: CustomMarkColour): number {
  const [red, green, blue] = [1, 3, 5].map((start) =>
    linearChannel(Number.parseInt(colour.slice(start, start + 2), 16) / 255),
  ) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function linearChannel(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

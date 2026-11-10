import type { CSSProperties } from "react";
import type { Palette } from "./apply-appearance.ts";

/**
 * A palette's own page, border and line colours, as set in its file in `palettes/`, for a swatch or
 * a preview drawn in that palette whatever palette is shown.
 */
export function paletteSampleStyle(palette: Palette): CSSProperties {
  return {
    "--palette-sample-page": `var(--palette-${palette}-page)`,
    "--palette-sample-border": `var(--palette-${palette}-border)`,
    "--palette-sample-line": `var(--palette-${palette}-line)`,
  } as CSSProperties;
}

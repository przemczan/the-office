import type { ReactNode } from "react";
import type { Palette } from "./apply-appearance.ts";
import { paletteSampleStyle } from "./palette-sample.ts";

/** A small square in a palette's own colours, for choosing it. */
export function PaletteSwatch({ palette }: { readonly palette: Palette }): ReactNode {
  return (
    <span
      className="palette-swatch"
      data-palette-swatch={palette}
      style={paletteSampleStyle(palette)}
      aria-hidden="true"
    />
  );
}

import type { ReactNode } from "react";
import type { Palette } from "./apply-appearance.ts";

/** A small page in a palette's own colours; "system" shows Light and Dark side by side. */
export function PalettePreview({ palette }: { readonly palette: Palette | "system" }): ReactNode {
  return (
    <span className="palette-preview" data-palette-preview={palette} aria-hidden="true">
      <i />
      <i />
    </span>
  );
}

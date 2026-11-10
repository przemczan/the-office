import type { ReactNode } from "react";
import type { Density } from "./apply-appearance.ts";

/**
 * A card above two rows, drawn with the density aliases at that density whatever density is shown,
 * for choosing it. Its colours are the palette's shown, as a density changes none.
 */
export function DensityPreview({ density }: { readonly density: Density }): ReactNode {
  return (
    <span className="density-preview" data-density={density} aria-hidden="true">
      <span className="density-preview-card">
        <i />
        <i />
      </span>
      <span className="density-preview-row">
        <i />
      </span>
      <span className="density-preview-row">
        <i />
      </span>
    </span>
  );
}

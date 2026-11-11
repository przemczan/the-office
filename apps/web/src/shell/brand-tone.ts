import { useAppearance, type PaletteBase } from "@the-office/ui";

/**
 * The brand marks' tone for the base of the palette shown: logos keep their brand colours in every
 * palette (spec §4), where the Logo's own "auto" tone would follow the muted text.
 */
export function useBrandTone(): PaletteBase {
  return useAppearance().base;
}

import { useAppearance, type LogoProps } from "@the-office/ui";

/**
 * The lockup's tone for the base of the palette shown: logos keep their brand colours in every
 * palette (spec §4), where the Logo's own "auto" tone would follow the muted text.
 */
export function useBrandTone(): NonNullable<LogoProps["tone"]> {
  return useAppearance().base;
}

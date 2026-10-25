import { useAppearance, type LogoProps } from "@the-office/ui";

/**
 * The lockup's tone for the palette shown: logos keep their brand colours in every palette
 * (prototypes/themes.md), where the Logo's own "auto" tone would follow the muted text.
 */
export function useBrandTone(): NonNullable<LogoProps["tone"]> {
  return useAppearance().palette === "dark" ? "dark" : "light";
}

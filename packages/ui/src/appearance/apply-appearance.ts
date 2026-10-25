/** The palettes tier 1 ships (spec §4), each over the design system's light or dark aliases. */
export const PALETTES = {
  light: { name: "Light", base: "light" },
  dark: { name: "Dark", base: "dark" },
} as const satisfies Record<string, { readonly name: string; readonly base: "light" | "dark" }>;

export type Palette = keyof typeof PALETTES;

/** What `applyAppearance` needs, passed in so that it can run on its own before the first paint. */
export interface AppearanceRules {
  /** Where the chosen palette is kept, in local storage. */
  readonly storageKey: string;
  /** The design system's alias set (`data-theme`) each palette starts from. */
  readonly bases: Readonly<Record<string, string>>;
  readonly density: string;
}

export const APPEARANCE_RULES: AppearanceRules = {
  storageKey: "the-office.palette",
  bases: Object.fromEntries(Object.entries(PALETTES).map(([id, { base }]) => [id, base])),
  // Tier 1 ships Comfortable only.
  density: "comfortable",
};

/**
 * Sets the appearance on `<html>`: the chosen palette, or until one is chosen the system's light or
 * dark, with the density. The choice is read from local storage unless given. It also runs as an
 * inline script before the first paint (see vite.ts), so it reads nothing but its arguments and the
 * page's globals.
 */
export function applyAppearance(rules: AppearanceRules, chosenPalette?: string | null): void {
  let chosen = chosenPalette;
  if (chosen === undefined) {
    try {
      chosen = localStorage.getItem(rules.storageKey);
    } catch {
      // Storage is blocked (a private window): follow the system.
      chosen = null;
    }
  }
  const systemPalette = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const palette = chosen !== null && Object.hasOwn(rules.bases, chosen) ? chosen : systemPalette;
  const root = document.documentElement;
  root.dataset.theme = rules.bases[palette];
  root.dataset.palette = palette;
  root.dataset.density = rules.density;
}

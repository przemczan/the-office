/**
 * The design system's alias set (`data-theme`) a palette starts from. It decides anything that
 * follows light or dark rather than the palette itself, such as which version of an Icon shows.
 */
export type PaletteBase = "light" | "dark";

/**
 * The palettes (spec §4), each over its base. Each has its file in `palettes/`, which also gives
 * its swatch and preview colours.
 */
export const PALETTES = {
  light: { name: "Light", base: "light" },
  dark: { name: "Dark", base: "dark" },
  graphite: { name: "Graphite", base: "dark" },
  paper: { name: "Paper", base: "light" },
  midnight: { name: "Midnight", base: "dark" },
  mist: { name: "Mist", base: "light" },
  mocha: { name: "Mocha", base: "dark" },
  sage: { name: "Sage", base: "light" },
  aubergine: { name: "Aubergine", base: "dark" },
  lavender: { name: "Lavender", base: "light" },
  lagoon: { name: "Lagoon", base: "dark" },
  cobalt: { name: "Cobalt", base: "light" },
  emerald: { name: "Emerald", base: "dark" },
  citrine: { name: "Citrine", base: "light" },
} as const satisfies Record<string, { readonly name: string; readonly base: PaletteBase }>;

export type Palette = keyof typeof PALETTES;

/** The densities (spec §4), from the tightest. Each has its file in `densities/`. */
export const DENSITIES = {
  compact: { name: "Compact" },
  comfortable: { name: "Comfortable" },
  relaxed: { name: "Relaxed" },
} as const satisfies Record<string, { readonly name: string }>;

export type Density = keyof typeof DENSITIES;

/** What `applyAppearance` needs, passed in so that it can run on its own before the first paint. */
export interface AppearanceRules {
  /** Where the chosen palette is kept, in local storage. */
  readonly paletteKey: string;
  /** The design system's alias set (`data-theme`) each palette starts from. */
  readonly bases: Readonly<Record<string, string>>;
  /** Where the chosen density is kept, in local storage. */
  readonly densityKey: string;
  readonly densities: readonly string[];
  /** The density shown until another is chosen. */
  readonly defaultDensity: string;
}

export const APPEARANCE_RULES: AppearanceRules = {
  paletteKey: "the-office.palette",
  bases: Object.fromEntries(Object.entries(PALETTES).map(([id, { base }]) => [id, base])),
  densityKey: "the-office.density",
  densities: Object.keys(DENSITIES),
  defaultDensity: "comfortable" satisfies Density,
};

/** A palette and a density as chosen; null where none is. */
export interface AppearanceChoice {
  readonly palette: string | null;
  readonly density: string | null;
}

/**
 * Sets the appearance on `<html>`: the chosen palette, or until one is chosen the system's light or
 * dark, and the chosen density, or Comfortable. The choice is read from local storage unless given.
 * It also runs as an inline script before the first paint (see vite.ts), so it reads nothing but its
 * arguments and the page's globals.
 */
export function applyAppearance(rules: AppearanceRules, choice?: AppearanceChoice): void {
  // Inside, as the inline script is this function's text alone.
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const kept = (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch {
      // Storage is blocked (a private window): nothing is kept.
      return null;
    }
  };
  const chosenPalette = choice === undefined ? kept(rules.paletteKey) : choice.palette;
  const chosenDensity = choice === undefined ? kept(rules.densityKey) : choice.density;
  const systemPalette = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const palette =
    chosenPalette !== null && Object.hasOwn(rules.bases, chosenPalette)
      ? chosenPalette
      : systemPalette;
  const density =
    chosenDensity !== null && rules.densities.includes(chosenDensity)
      ? chosenDensity
      : rules.defaultDensity;
  const root = document.documentElement;
  root.dataset.theme = rules.bases[palette];
  root.dataset.palette = palette;
  root.dataset.density = density;
}

/** applyAppearance as an inline script for the page's head, run before the first paint. */
export function appearanceScript(): string {
  return `(${applyAppearance.toString()})(${JSON.stringify(APPEARANCE_RULES)});`;
}

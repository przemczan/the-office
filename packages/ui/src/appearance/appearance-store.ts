import {
  APPEARANCE_RULES,
  applyAppearance,
  DENSITIES,
  PALETTES,
  type Density,
  type Palette,
  type PaletteBase,
} from "./apply-appearance.ts";

export interface Appearance {
  /** The palette shown. */
  readonly palette: Palette;
  /** The light or dark base of the palette shown. */
  readonly base: PaletteBase;
  /** The palette the user chose, or undefined while the system's light or dark is followed. */
  readonly chosenPalette: Palette | undefined;
  /** The density shown: the one the user chose, or Comfortable. */
  readonly density: Density;
}

/** The appearance of this browser, in the shape React's `useSyncExternalStore` reads. */
export interface AppearanceStore {
  /** The same object until the appearance changes. */
  current(): Appearance;
  choosePalette(palette: Palette): void;
  /** Forgets the chosen palette, so the system's light or dark is shown again. */
  followSystem(): void;
  chooseDensity(density: Density): void;
  subscribe(onChange: () => void): () => void;
}

const SYSTEM_DARK = "(prefers-color-scheme: dark)";

/**
 * Keeps the chosen palette and density in local storage, or for this page alone where storage is
 * blocked.
 */
export function createAppearanceStore(): AppearanceStore {
  let chosenPalette = stored(APPEARANCE_RULES.paletteKey, PALETTES);
  let chosenDensity = stored(APPEARANCE_RULES.densityKey, DENSITIES);
  let appearance = apply(chosenPalette, chosenDensity);
  const listeners = new Set<() => void>();

  const update = (): void => {
    appearance = apply(chosenPalette, chosenDensity);
    for (const listener of listeners) listener();
  };
  // Another tab chose a palette or a density, or cleared what this browser keeps.
  const onStorage = (event: StorageEvent): void => {
    const { key } = event;
    if (key !== null && key !== APPEARANCE_RULES.paletteKey && key !== APPEARANCE_RULES.densityKey)
      return;
    chosenPalette = stored(APPEARANCE_RULES.paletteKey, PALETTES);
    chosenDensity = stored(APPEARANCE_RULES.densityKey, DENSITIES);
    update();
  };

  return {
    current: () => appearance,
    choosePalette: (palette) => {
      chosenPalette = palette;
      keep(APPEARANCE_RULES.paletteKey, palette);
      update();
    },
    followSystem: () => {
      chosenPalette = undefined;
      keep(APPEARANCE_RULES.paletteKey, undefined);
      update();
    },
    chooseDensity: (density) => {
      chosenDensity = density;
      keep(APPEARANCE_RULES.densityKey, density);
      update();
    },
    subscribe: (onChange) => {
      if (listeners.size === 0) {
        matchMedia(SYSTEM_DARK).addEventListener("change", update);
        window.addEventListener("storage", onStorage);
      }
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
        if (listeners.size > 0) return;
        matchMedia(SYSTEM_DARK).removeEventListener("change", update);
        window.removeEventListener("storage", onStorage);
      };
    },
  };
}

function apply(chosenPalette: Palette | undefined, chosenDensity: Density | undefined): Appearance {
  applyAppearance(APPEARANCE_RULES, {
    palette: chosenPalette ?? null,
    density: chosenDensity ?? null,
  });
  const { palette, density } = document.documentElement.dataset as {
    palette: Palette;
    density: Density;
  };
  return { palette, base: PALETTES[palette].base, chosenPalette, density };
}

/** What local storage keeps under the key, if it is one of the choices. */
function stored<Choice extends string>(
  key: string,
  choices: Readonly<Record<Choice, unknown>>,
): Choice | undefined {
  try {
    const value = localStorage.getItem(key);
    return value !== null && Object.hasOwn(choices, value) ? (value as Choice) : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps the choice, or forgets it when undefined. */
function keep(key: string, value: string | undefined): void {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage is blocked: the choice lasts until the page is closed.
  }
}

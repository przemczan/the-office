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

/** A palette and a density as chosen: undefined follows the system, and is Comfortable. */
export interface ChosenAppearance {
  readonly palette: Palette | undefined;
  readonly density: Density | undefined;
}

/**
 * Hears a choice made on this page, to keep it elsewhere, such as with the user's account. While
 * the promise it answers is unsettled, `adopt` leaves the choice alone.
 */
export type AppearanceChosenListener = (choice: ChosenAppearance) => Promise<unknown> | undefined;

/** The appearance of this browser, in the shape React's `useSyncExternalStore` reads. */
export interface AppearanceStore {
  /** The same object until the appearance changes. */
  current(): Appearance;
  choosePalette(palette: Palette): void;
  /** Forgets the chosen palette, so the system's light or dark is shown again. */
  followSystem(): void;
  chooseDensity(density: Density): void;
  /**
   * Shows a choice made elsewhere, such as the signed-in user's, and keeps it as this browser's
   * cache; skipped while a choice made here is still being kept, so it can't undo a fresh one.
   */
  adopt(choice: ChosenAppearance): void;
  onChosen(listener: AppearanceChosenListener): () => void;
  subscribe(onChange: () => void): () => void;
}

const SYSTEM_DARK = "(prefers-color-scheme: dark)";

/**
 * Keeps the chosen palette and density in local storage, this browser's cache of the last
 * signed-in user's, which the inline script paints from before the first paint; for this page alone
 * where storage is blocked.
 */
export function createAppearanceStore(): AppearanceStore {
  let chosenPalette = stored(APPEARANCE_RULES.paletteKey, PALETTES);
  let chosenDensity = stored(APPEARANCE_RULES.densityKey, DENSITIES);
  let appearance = apply(chosenPalette, chosenDensity);
  const listeners = new Set<() => void>();
  const chosenListeners = new Set<AppearanceChosenListener>();
  let choicesBeingKept = 0;

  const update = (): void => {
    appearance = apply(chosenPalette, chosenDensity);
    for (const listener of listeners) listener();
  };
  const announceChoice = (): void => {
    for (const listener of chosenListeners) {
      const kept = listener({ palette: chosenPalette, density: chosenDensity });
      if (kept === undefined) continue;
      choicesBeingKept += 1;
      const settled = (): void => {
        choicesBeingKept -= 1;
      };
      kept.then(settled, settled);
    }
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
      announceChoice();
    },
    followSystem: () => {
      chosenPalette = undefined;
      keep(APPEARANCE_RULES.paletteKey, undefined);
      update();
      announceChoice();
    },
    chooseDensity: (density) => {
      chosenDensity = density;
      keep(APPEARANCE_RULES.densityKey, density);
      update();
      announceChoice();
    },
    adopt: ({ palette, density }) => {
      if (choicesBeingKept > 0) return;
      if (palette === chosenPalette && density === chosenDensity) return;
      chosenPalette = palette;
      chosenDensity = density;
      keep(APPEARANCE_RULES.paletteKey, palette);
      keep(APPEARANCE_RULES.densityKey, density);
      update();
    },
    onChosen: (listener) => {
      chosenListeners.add(listener);
      return () => {
        chosenListeners.delete(listener);
      };
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

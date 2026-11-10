import {
  APPEARANCE_RULES,
  applyAppearance,
  PALETTES,
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
}

/** The appearance of this browser, in the shape React's `useSyncExternalStore` reads. */
export interface AppearanceStore {
  /** The same object until the appearance changes. */
  current(): Appearance;
  choosePalette(palette: Palette): void;
  /** Forgets the chosen palette, so the system's light or dark is shown again. */
  followSystem(): void;
  subscribe(onChange: () => void): () => void;
}

const SYSTEM_DARK = "(prefers-color-scheme: dark)";

/** Keeps the chosen palette in local storage, or for this page alone where storage is blocked. */
export function createAppearanceStore(): AppearanceStore {
  let chosenPalette = storedPalette();
  let appearance = apply(chosenPalette);
  const listeners = new Set<() => void>();

  const update = (): void => {
    appearance = apply(chosenPalette);
    for (const listener of listeners) listener();
  };
  // Another tab chose a palette.
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== APPEARANCE_RULES.storageKey) return;
    chosenPalette = storedPalette();
    update();
  };

  return {
    current: () => appearance,
    choosePalette: (palette) => {
      chosenPalette = palette;
      try {
        localStorage.setItem(APPEARANCE_RULES.storageKey, palette);
      } catch {
        // Storage is blocked: the choice lasts until the page is closed.
      }
      update();
    },
    followSystem: () => {
      chosenPalette = undefined;
      try {
        localStorage.removeItem(APPEARANCE_RULES.storageKey);
      } catch {
        // Storage is blocked: nothing was kept.
      }
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

function apply(chosenPalette: Palette | undefined): Appearance {
  applyAppearance(APPEARANCE_RULES, chosenPalette ?? null);
  const palette = document.documentElement.dataset.palette as Palette;
  return { palette, base: PALETTES[palette].base, chosenPalette };
}

function storedPalette(): Palette | undefined {
  try {
    const stored = localStorage.getItem(APPEARANCE_RULES.storageKey);
    return stored !== null && Object.hasOwn(PALETTES, stored) ? (stored as Palette) : undefined;
  } catch {
    return undefined;
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPEARANCE_RULES, appearanceScript } from "./apply-appearance.ts";
import { createAppearanceStore } from "./appearance-store.ts";

/** The system's light or dark setting, which jsdom lacks; `set` changes it as the system would. */
function stubSystem(initiallyDark: boolean): { set(dark: boolean): void } {
  let dark = initiallyDark;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query === "(prefers-color-scheme: dark)" && dark;
    },
    addEventListener: (_type: "change", listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: "change", listener: () => void) => listeners.delete(listener),
  }));
  return {
    set: (nowDark) => {
      dark = nowDark;
      for (const listener of listeners) listener();
    },
  };
}

function shownAppearance(): Record<string, string | undefined> {
  const { theme, palette, density } = document.documentElement.dataset;
  return { theme, palette, density };
}

beforeEach(() => {
  localStorage.clear();
  for (const attribute of ["data-theme", "data-palette", "data-density"]) {
    document.documentElement.removeAttribute(attribute);
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the appearance", () => {
  it("follows the system's light or dark until a palette is chosen", () => {
    stubSystem(true);

    const appearance = createAppearanceStore();

    expect(appearance.current()).toEqual({ palette: "dark", chosenPalette: undefined });
    expect(shownAppearance()).toEqual({ theme: "dark", palette: "dark", density: "comfortable" });
  });

  it("follows the system as it changes while no palette is chosen", () => {
    const system = stubSystem(false);
    const appearance = createAppearanceStore();
    const onChange = vi.fn<() => void>();
    appearance.subscribe(onChange);

    system.set(true);

    expect(onChange).toHaveBeenCalledOnce();
    expect(appearance.current().palette).toBe("dark");
    expect(shownAppearance().theme).toBe("dark");
  });

  it("keeps the chosen palette across page loads, whatever the system says", () => {
    const system = stubSystem(true);
    createAppearanceStore().choosePalette("light");

    const reloaded = createAppearanceStore();
    reloaded.subscribe(() => undefined);
    system.set(false);
    system.set(true);

    expect(reloaded.current()).toEqual({ palette: "light", chosenPalette: "light" });
    expect(shownAppearance()).toEqual({ theme: "light", palette: "light", density: "comfortable" });
  });

  it("shows the palette another tab chose", () => {
    stubSystem(false);
    const appearance = createAppearanceStore();
    appearance.subscribe(() => undefined);

    localStorage.setItem(APPEARANCE_RULES.storageKey, "dark");
    window.dispatchEvent(new StorageEvent("storage", { key: APPEARANCE_RULES.storageKey }));

    expect(appearance.current()).toEqual({ palette: "dark", chosenPalette: "dark" });
  });

  it("follows the system when the kept palette is not one tier 1 ships", () => {
    stubSystem(true);
    localStorage.setItem(APPEARANCE_RULES.storageKey, "graphite");

    expect(createAppearanceStore().current()).toEqual({
      palette: "dark",
      chosenPalette: undefined,
    });
  });

  it("is set by the inline script before the first paint", () => {
    stubSystem(false);
    localStorage.setItem(APPEARANCE_RULES.storageKey, "dark");

    // The script runs as the browser runs an inline script: alone, on the page's globals.
    new Function(appearanceScript())();

    expect(shownAppearance()).toEqual({ theme: "dark", palette: "dark", density: "comfortable" });
  });
});

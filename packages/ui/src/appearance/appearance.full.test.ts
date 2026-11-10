import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPEARANCE_RULES, appearanceScript, DENSITIES } from "./apply-appearance.ts";
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
  vi.restoreAllMocks();
});

describe("the appearance", () => {
  it("follows the system's light or dark until a palette is chosen", () => {
    stubSystem(true);

    const appearance = createAppearanceStore();

    expect(appearance.current()).toEqual({
      palette: "dark",
      base: "dark",
      chosenPalette: undefined,
      density: "comfortable",
    });
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

    expect(reloaded.current()).toEqual({
      palette: "light",
      base: "light",
      chosenPalette: "light",
      density: "comfortable",
    });
    expect(shownAppearance()).toEqual({ theme: "light", palette: "light", density: "comfortable" });
  });

  it("follows the system again once asked to, across page loads", () => {
    const system = stubSystem(false);
    const appearance = createAppearanceStore();
    appearance.choosePalette("dark");

    appearance.followSystem();

    expect(appearance.current()).toEqual({
      palette: "light",
      base: "light",
      chosenPalette: undefined,
      density: "comfortable",
    });
    const reloaded = createAppearanceStore();
    reloaded.subscribe(() => undefined);
    system.set(true);
    expect(reloaded.current()).toEqual({
      palette: "dark",
      base: "dark",
      chosenPalette: undefined,
      density: "comfortable",
    });
  });

  it("shows the palette another tab chose", () => {
    stubSystem(false);
    const appearance = createAppearanceStore();
    appearance.subscribe(() => undefined);

    localStorage.setItem(APPEARANCE_RULES.paletteKey, "dark");
    window.dispatchEvent(new StorageEvent("storage", { key: APPEARANCE_RULES.paletteKey }));

    expect(appearance.current()).toEqual({
      palette: "dark",
      base: "dark",
      chosenPalette: "dark",
      density: "comfortable",
    });
  });

  it.each([
    { palette: "graphite", base: "dark" },
    { palette: "paper", base: "light" },
  ] as const)(
    "shows a chosen $palette over its $base base, across page loads",
    ({ palette, base }) => {
      const system = stubSystem(base === "light");
      createAppearanceStore().choosePalette(palette);

      const reloaded = createAppearanceStore();
      reloaded.subscribe(() => undefined);
      system.set(base === "dark");

      expect(reloaded.current()).toEqual({
        palette,
        base,
        chosenPalette: palette,
        density: "comfortable",
      });
      expect(shownAppearance()).toEqual({ theme: base, palette, density: "comfortable" });
    },
  );

  it("follows the system when the kept palette is not a palette", () => {
    stubSystem(true);
    localStorage.setItem(APPEARANCE_RULES.paletteKey, "sepia");

    expect(createAppearanceStore().current()).toEqual({
      palette: "dark",
      base: "dark",
      chosenPalette: undefined,
      density: "comfortable",
    });
  });

  it.each([
    { palette: "dark", base: "dark" },
    { palette: "graphite", base: "dark" },
    { palette: "paper", base: "light" },
  ])("sets a kept $palette by the inline script before the first paint", ({ palette, base }) => {
    stubSystem(base === "light");
    localStorage.setItem(APPEARANCE_RULES.paletteKey, palette);

    // The script runs as the browser runs an inline script: alone, on the page's globals.
    new Function(appearanceScript())();

    expect(shownAppearance()).toEqual({ theme: base, palette, density: "comfortable" });
  });
});

describe("the density", () => {
  it("is Comfortable until another is chosen", () => {
    stubSystem(false);

    expect(createAppearanceStore().current().density).toBe("comfortable");
    expect(shownAppearance().density).toBe("comfortable");
  });

  it.each(["compact", "relaxed"] as const)("shows a chosen %s, across page loads", (density) => {
    stubSystem(false);
    createAppearanceStore().choosePalette("paper");
    createAppearanceStore().chooseDensity(density);

    const reloaded = createAppearanceStore();

    expect(reloaded.current()).toEqual({
      palette: "paper",
      base: "light",
      chosenPalette: "paper",
      density,
    });
    expect(shownAppearance()).toEqual({ theme: "light", palette: "paper", density });
  });

  it("is kept apart from the palette: following the system keeps the density", () => {
    stubSystem(true);
    const appearance = createAppearanceStore();
    appearance.chooseDensity("compact");
    appearance.choosePalette("light");

    appearance.followSystem();

    expect(appearance.current()).toEqual({
      palette: "dark",
      base: "dark",
      chosenPalette: undefined,
      density: "compact",
    });
  });

  it("shows the density another tab chose", () => {
    stubSystem(false);
    const appearance = createAppearanceStore();
    const onChange = vi.fn<() => void>();
    appearance.subscribe(onChange);

    localStorage.setItem(APPEARANCE_RULES.densityKey, "relaxed");
    window.dispatchEvent(new StorageEvent("storage", { key: APPEARANCE_RULES.densityKey }));

    expect(onChange).toHaveBeenCalledOnce();
    expect(appearance.current().density).toBe("relaxed");
    expect(shownAppearance().density).toBe("relaxed");
  });

  it("goes back to Comfortable when another tab clears what this browser keeps", () => {
    stubSystem(false);
    const appearance = createAppearanceStore();
    appearance.subscribe(() => undefined);
    appearance.chooseDensity("compact");

    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));

    expect(appearance.current().density).toBe("comfortable");
  });

  it("is Comfortable when the kept density is not a density", () => {
    stubSystem(false);
    localStorage.setItem(APPEARANCE_RULES.densityKey, "spacious");

    expect(createAppearanceStore().current().density).toBe("comfortable");
    new Function(appearanceScript())();
    expect(shownAppearance().density).toBe("comfortable");
  });

  it.each(Object.keys(DENSITIES))(
    "sets a kept %s by the inline script before the first paint",
    (density) => {
      stubSystem(false);
      localStorage.setItem(APPEARANCE_RULES.densityKey, density);

      new Function(appearanceScript())();

      expect(shownAppearance()).toEqual({ theme: "light", palette: "light", density });
    },
  );

  it("lasts for the page when storage is blocked", () => {
    stubSystem(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    const appearance = createAppearanceStore();

    appearance.chooseDensity("relaxed");

    expect(appearance.current().density).toBe("relaxed");
    expect(shownAppearance().density).toBe("relaxed");
    new Function(appearanceScript())();
    expect(shownAppearance().density).toBe("comfortable");
  });
});

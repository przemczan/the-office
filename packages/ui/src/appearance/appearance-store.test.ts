import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appearanceScript } from "./apply-appearance.ts";
import { createAppearanceStore, type ChosenAppearance } from "./appearance-store.ts";

function shownAppearance(): Record<string, string | undefined> {
  const { theme, palette, density } = document.documentElement.dataset;
  return { theme, palette, density };
}

beforeEach(() => {
  localStorage.clear();
  for (const attribute of ["data-theme", "data-palette", "data-density"]) {
    document.documentElement.removeAttribute(attribute);
  }
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the account's appearance, cached in this browser", () => {
  it("is shown once adopted, and painted from the cache before the next page's first paint", () => {
    createAppearanceStore().adopt({ palette: "mocha", density: "compact" });
    expect(shownAppearance()).toEqual({ theme: "dark", palette: "mocha", density: "compact" });

    for (const attribute of ["data-theme", "data-palette", "data-density"]) {
      document.documentElement.removeAttribute(attribute);
    }
    // The inline script, as the page's head runs it before anything renders.
    new Function(appearanceScript())();

    expect(shownAppearance()).toEqual({ theme: "dark", palette: "mocha", density: "compact" });
  });

  it("tells a listener each choice made here, and adopts nothing while it is being kept", async () => {
    const store = createAppearanceStore();
    const chosen: ChosenAppearance[] = [];
    let keep: (() => void) | undefined;
    store.onChosen((choice) => {
      chosen.push(choice);
      return new Promise<void>((resolve) => {
        keep = resolve;
      });
    });

    store.choosePalette("sage");
    // The account as read before the choice was kept would undo it.
    store.adopt({ palette: undefined, density: undefined });

    expect(chosen).toEqual([{ palette: "sage", density: undefined }]);
    expect(shownAppearance().palette).toBe("sage");

    keep?.();
    await Promise.resolve();
    store.adopt({ palette: "cobalt", density: "relaxed" });
    expect(shownAppearance()).toEqual({ theme: "light", palette: "cobalt", density: "relaxed" });
    expect(localStorage.getItem("the-office.palette")).toBe("cobalt");
  });

  it("follows the system and Comfortable once the account chooses neither", () => {
    const store = createAppearanceStore();
    store.choosePalette("midnight");
    store.chooseDensity("relaxed");

    store.adopt({ palette: undefined, density: undefined });

    expect(shownAppearance()).toEqual({ theme: "light", palette: "light", density: "comfortable" });
    expect(localStorage.getItem("the-office.palette")).toBeNull();
  });
});

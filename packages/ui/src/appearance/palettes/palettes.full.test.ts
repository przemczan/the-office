import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PALETTES, type Palette } from "../apply-appearance.ts";

const SPEC = readFileSync(
  path.resolve(import.meta.dirname, "../../../../../docs/spec/4-ux-direction.md"),
  "utf8",
);

/** The aliases spec §4 gives a palette, from its heading to the next palette's or the densities'. */
function specValues(name: string): Record<string, string> {
  const start = SPEC.indexOf(`\n### ${name}\n`);
  const end = SPEC.indexOf("\n##", start + 1);
  const section = SPEC.slice(start, end);
  const values = [...section.matchAll(/`(--[\w-]+): (#[0-9A-Fa-f]{6})`/g)].map(
    ([, alias = "", value = ""]) => [alias, value.toLowerCase()],
  );
  return Object.fromEntries(values);
}

/** The aliases a palette's file sets on `<html>`, leaving out its swatch and preview colours. */
function fileValues(palette: string): Record<string, string> {
  const css = readFileSync(path.resolve(import.meta.dirname, `${palette}.css`), "utf8");
  const block = css.slice(css.indexOf(`:root[data-palette="${palette}"]`));
  const body = block.slice(block.indexOf("{") + 1, block.indexOf("}"));
  const values = [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, alias = "", value = ""]) => [
    alias,
    value.trim().toLowerCase(),
  ]);
  return Object.fromEntries(values);
}

/** WCAG's relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG's contrast ratio between two `#rrggbb` colours. */
function contrast(first: string, second: string): number {
  const [lighter = 0, darker = 0] = [luminance(first), luminance(second)].toSorted((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const HEX = /^#[0-9a-f]{6}$/;
const TEXT_ALIASES = ["--fg-1", "--fg-2"] as const;
const BACKGROUND_ALIASES = ["--bg", "--surface", "--surface-raised"] as const;
const PRIMARY_BACKGROUND_ALIASES = ["--primary", "--primary-hover"] as const;

/** Light and Dark are the design system's own aliases; every other palette has its values in the spec. */
const SPEC_PALETTES = Object.keys(PALETTES).filter(
  (palette) => palette !== "light" && palette !== "dark",
) as Palette[];

/** The palettes whose file gives every text and background alias the contrast check reads. */
const PALETTES_SETTING_TEXT = (Object.keys(PALETTES) as Palette[]).filter((palette) => {
  const values = fileValues(palette);
  return [...TEXT_ALIASES, ...BACKGROUND_ALIASES].every((alias) => HEX.test(values[alias] ?? ""));
});

/** The palettes whose file gives the primary buttons' text and backgrounds. */
const PALETTES_SETTING_PRIMARY = (Object.keys(PALETTES) as Palette[]).filter((palette) => {
  const values = fileValues(palette);
  return ["--primary-fg", ...PRIMARY_BACKGROUND_ALIASES].every((alias) =>
    HEX.test(values[alias] ?? ""),
  );
});

describe("the palettes after Light and Dark", () => {
  it.each(SPEC_PALETTES)("%s sets exactly spec §4's colour values", (palette) => {
    // The lockup's ink follows the palette's base (apps/web's brand-tone.ts), so no palette sets it.
    const { "--brand-ink": _brandInk, ...expected } = specValues(PALETTES[palette].name);

    expect(Object.keys(expected).length).toBeGreaterThan(0);
    expect(fileValues(palette)).toEqual(expected);
  });

  it.each([
    ["graphite", "dark"],
    ["paper", "light"],
    ["midnight", "dark"],
    ["mist", "light"],
    ["mocha", "dark"],
    ["sage", "light"],
    ["aubergine", "dark"],
    ["lavender", "light"],
    ["lagoon", "dark"],
    ["cobalt", "light"],
    ["emerald", "dark"],
    ["citrine", "light"],
  ] as const)("puts %s over the %s base", (palette, base) => {
    expect(PALETTES[palette].base).toBe(base);
  });
});

describe("text contrast", () => {
  it("is checked on every palette but Light, which takes the design system's own", () => {
    expect(PALETTES_SETTING_TEXT).toEqual(["dark", ...SPEC_PALETTES]);
  });

  it.each(PALETTES_SETTING_TEXT)("%s's text reaches 4.5:1 on its backgrounds", (palette) => {
    const values = fileValues(palette);
    for (const text of TEXT_ALIASES) {
      for (const background of BACKGROUND_ALIASES) {
        const ratio = contrast(values[text] ?? "", values[background] ?? "");
        expect(ratio, `${text} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("primary button contrast", () => {
  it("is checked on every palette that sets its own primary", () => {
    expect(PALETTES_SETTING_PRIMARY).toEqual([
      "dark",
      "graphite",
      "midnight",
      "mocha",
      "aubergine",
      "lavender",
      "lagoon",
      "cobalt",
      "emerald",
      "citrine",
    ]);
  });

  it.each(PALETTES_SETTING_PRIMARY)("%s's primary text reaches 4.5:1 on its buttons", (palette) => {
    const values = fileValues(palette);
    for (const background of PRIMARY_BACKGROUND_ALIASES) {
      const ratio = contrast(values["--primary-fg"] ?? "", values[background] ?? "");
      expect(ratio, `--primary-fg on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

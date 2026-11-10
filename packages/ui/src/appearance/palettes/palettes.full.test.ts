import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PALETTES } from "../apply-appearance.ts";

const SPEC = readFileSync(
  path.resolve(import.meta.dirname, "../../../../../docs/spec/4-ux-direction.md"),
  "utf8",
);

/** The aliases spec §4 gives a palette, from its bullet to the next palette's or the densities'. */
function specValues(name: string): Record<string, string> {
  const start = SPEC.indexOf(`  - **${name}** sets`);
  const end = SPEC.indexOf("\n  - **", start + 1);
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

describe("the palettes added in tier 3", () => {
  it.each(["graphite", "paper"] as const)("%s sets exactly spec §4's colour values", (palette) => {
    // The lockup's ink follows the palette's base (apps/web's brand-tone.ts), so no palette sets it.
    const { "--brand-ink": _brandInk, ...expected } = specValues(PALETTES[palette].name);

    expect(Object.keys(expected).length).toBeGreaterThan(0);
    expect(fileValues(palette)).toEqual(expected);
  });

  it("puts Graphite over the dark base and Paper over the light one", () => {
    expect(PALETTES.graphite.base).toBe("dark");
    expect(PALETTES.paper.base).toBe("light");
  });
});

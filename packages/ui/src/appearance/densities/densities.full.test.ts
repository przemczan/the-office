import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DENSITIES, PALETTES } from "../apply-appearance.ts";

const SPEC = readFileSync(
  path.resolve(import.meta.dirname, "../../../../../docs/spec/4-ux-direction.md"),
  "utf8",
);

/** Spec §4's table of the density aliases: each alias's value in each density, by its column. */
function specValues(density: string): Record<string, string> {
  const rows = [...SPEC.matchAll(/^ *\| `(--[\w-]+)` +\|(.+)\|$/gm)];
  const columns = ["compact", "comfortable", "relaxed"];
  return Object.fromEntries(
    rows.map(([, alias = "", cells = ""]) => {
      const value = cells.split("|")[columns.indexOf(density)] ?? "";
      return [alias, value.trim().replaceAll("`", "")];
    }),
  );
}

/** The custom properties a CSS file sets, in its every block. */
function fileValues(file: string): Record<string, string> {
  const css = readFileSync(path.resolve(import.meta.dirname, file), "utf8").replaceAll(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const values = [...css.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, alias = "", value = ""]) => [
    alias,
    value.trim(),
  ]);
  return Object.fromEntries(values);
}

describe("the densities", () => {
  it.each(Object.keys(DENSITIES))("%s sets exactly spec §4's values", (density) => {
    const expected = specValues(density);

    expect(Object.keys(expected)).toHaveLength(10);
    expect(fileValues(`${density}.css`)).toEqual(expected);
  });

  it.each(Object.keys(PALETTES))("the %s palette sets no density alias", (palette) => {
    const densityAliases = Object.keys(specValues("comfortable"));

    const set = Object.keys(fileValues(`../palettes/${palette}.css`));

    expect(set.filter((alias) => densityAliases.includes(alias))).toEqual([]);
  });
});

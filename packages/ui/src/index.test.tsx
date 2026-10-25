import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as ui from "./index.ts";

const COMPONENTS_DIRECTORY = path.resolve(import.meta.dirname, "../../../design-system/components");

function declaredComponents(): string[] {
  return readdirSync(COMPONENTS_DIRECTORY, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".d.ts"))
    .flatMap((file) => {
      const declarations = readFileSync(path.join(COMPONENTS_DIRECTORY, file), "utf8");
      return [...declarations.matchAll(/export declare function (\w+)/g)].map((match) => match[1]!);
    });
}

describe("@the-office/ui", () => {
  it("exports every component the design system declares", () => {
    expect(Object.keys(ui)).toEqual(expect.arrayContaining(declaredComponents()));
  });

  it("draws icons from the bundled Lucide set", () => {
    const markup = renderToStaticMarkup(<ui.Icon name="inbox" />);

    expect(markup).toContain("<polyline");
  });

  it("renders the design system's components", () => {
    const markup = renderToStaticMarkup(<ui.Button variant="secondary">Add Project</ui.Button>);

    expect(markup).toMatch(/^<button[^>]*>Add Project</);
  });
});

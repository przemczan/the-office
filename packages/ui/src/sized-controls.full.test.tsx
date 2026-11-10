import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { Button, Card, DataTable, IconButton, Input, SegmentedControl, Select } from "./index.ts";
import { tableDensity } from "./sized-controls.tsx";

function firstElement(markup: string, selector: string): HTMLElement {
  const page = document.createElement("div");
  page.innerHTML = markup;
  const element = page.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`No ${selector} in ${markup}`);
  return element;
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-density");
});

describe("the design system's controls at the chosen density", () => {
  it.each([
    ["sm", "var(--control-h)"],
    ["md", "calc(var(--control-h) + 4px)"],
    ["lg", "calc(var(--control-h) + 12px)"],
  ] as const)("size a %s Button, Input and Select on --control-h", (size, height) => {
    expect(
      firstElement(renderToStaticMarkup(<Button size={size}>Save</Button>), "button").style.height,
    ).toBe(height);
    expect(firstElement(renderToStaticMarkup(<Input size={size} />), "div").style.height).toBe(
      height,
    );
    expect(
      firstElement(renderToStaticMarkup(<Select size={size} options={["One"]} />), "select").dataset
        .controlSize,
    ).toBe(size);
  });

  it("sizes an IconButton and a SegmentedControl on --control-h", () => {
    const iconButton = firstElement(
      renderToStaticMarkup(<IconButton size="xs" icon={null} label="Close" />),
      "button",
    );
    expect([iconButton.style.width, iconButton.style.height]).toEqual([
      "calc(var(--control-h) - 4px)",
      "calc(var(--control-h) - 4px)",
    ]);
    const segmented = firstElement(
      renderToStaticMarkup(<SegmentedControl size="sm" options={["One", "Two"]} value="One" />),
      "[role=tablist]",
    );
    expect(segmented.style.height).toBe("var(--control-h)");
  });

  it("keeps a height its caller sets", () => {
    const markup = renderToStaticMarkup(<Button style={{ height: 22 }}>Save</Button>);

    expect(firstElement(markup, "button").style.height).toBe("22px");
  });
});

describe("the Card", () => {
  it("pads its header and body by the card aliases, as every card does", () => {
    const markup = renderToStaticMarkup(
      <Card title="Palette" subtitle="Kept in this browser">
        Body
      </Card>,
    );

    expect(firstElement(markup, "section > div > header.card-head h3").textContent).toBe("Palette");
    expect(firstElement(markup, ".card-head p").textContent).toBe("Kept in this browser");
    expect(firstElement(markup, ".card-body").dataset.underHead).toBe("true");
  });

  it("draws an edge-to-edge body with a divided header for padding none", () => {
    const markup = renderToStaticMarkup(
      <Card padding="none" actions={<button type="button">Add</button>}>
        Table
      </Card>,
    );

    expect(firstElement(markup, ".card-head").dataset.edgeToEdge).toBe("true");
    expect(firstElement(markup, ".card-body").dataset.edgeToEdge).toBe("true");
  });

  it("has no header without a title or actions", () => {
    const markup = renderToStaticMarkup(<Card>Body</Card>);

    expect(markup).not.toContain("card-head");
    expect(firstElement(markup, ".card-body").dataset.underHead).toBeUndefined();
  });
});

describe("a table's density", () => {
  it.each([
    ["default", "compact", "compact"],
    ["default", "comfortable", "default"],
    ["default", "relaxed", "relaxed"],
    ["relaxed", "compact", "default"],
    ["relaxed", "comfortable", "relaxed"],
    ["relaxed", "relaxed", "relaxed"],
    ["compact", "compact", "compact"],
  ] as const)("asked %s, is in %s %s", (asked, density, shown) => {
    expect(tableDensity(asked, density)).toBe(shown);
  });

  it("follows the density kept in this browser", () => {
    localStorage.setItem("the-office.density", "compact");
    const markup = renderToStaticMarkup(
      <DataTable columns={[{ key: "name", header: "Name" }]} rows={[{ id: "1", name: "Sam" }]} />,
    );

    // The design system's compact rows are 36 px tall.
    expect(firstElement(markup, "tbody tr").style.height).toBe("36px");
  });
});

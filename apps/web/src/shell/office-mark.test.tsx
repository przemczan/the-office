import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OfficeMark } from "./office-mark.tsx";

function fills(tone: "light" | "dark"): readonly string[] {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<OfficeMark size={30} tone={tone} />);
  return [...host.querySelectorAll("rect")].map((rect) => rect.getAttribute("fill") ?? "");
}

describe("OfficeMark", () => {
  it("draws a near-black body with off-white openings in the light tone", () => {
    const [body, ...openings] = fills("light");
    expect(body).toBe("var(--gray-950)");
    expect(openings.filter((fill) => fill === "var(--gray-50)")).toHaveLength(6);
  });

  it("swaps the body and the openings in the dark tone", () => {
    const [body, ...openings] = fills("dark");
    expect(body).toBe("var(--gray-50)");
    expect(openings.filter((fill) => fill === "var(--gray-950)")).toHaveLength(6);
  });

  it("keeps the ember window in both tones", () => {
    expect(fills("light").filter((fill) => fill === "var(--ember-500)")).toHaveLength(1);
    expect(fills("dark").filter((fill) => fill === "var(--ember-500)")).toHaveLength(1);
  });

  it("is as tall as its size, with the building's proportions", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<OfficeMark size={30} tone="light" />);
    const svg = host.querySelector("svg");
    expect(svg?.getAttribute("height")).toBe("30");
    expect(Number(svg?.getAttribute("width"))).toBeCloseTo((30 * 798) / 874);
  });
});

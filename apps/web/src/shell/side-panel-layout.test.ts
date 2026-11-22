import { describe, expect, it } from "vitest";
import { sidePanelLayout } from "./side-panel-layout.ts";

const WIDTHS = { least: 480, standard: 640, most: 1080 };

describe("sidePanelLayout", () => {
  it("keeps the remembered width when there is room", () => {
    expect(sidePanelLayout(1600, 800, WIDTHS)).toEqual({ width: 800, most: 1080, fills: false });
  });

  it("leaves some of the page in view beside it", () => {
    expect(sidePanelLayout(1000, 900, WIDTHS)).toEqual({ width: 760, most: 760, fills: false });
  });

  it("fills a window too narrow for its least width beside the page", () => {
    expect(sidePanelLayout(600, 640, WIDTHS)).toEqual({ width: 600, most: 600, fills: true });
  });
});

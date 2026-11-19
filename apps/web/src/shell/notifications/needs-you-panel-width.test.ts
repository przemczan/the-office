import { describe, expect, it } from "vitest";
import { needsYouPanelLayout } from "./needs-you-panel-width.ts";

describe("needsYouPanelLayout", () => {
  it("keeps the remembered width when there is room", () => {
    expect(needsYouPanelLayout(1600, 800)).toEqual({ width: 800, most: 1080, fills: false });
  });

  it("leaves some of the page in view beside it", () => {
    expect(needsYouPanelLayout(1000, 900)).toEqual({ width: 760, most: 760, fills: false });
  });

  it("fills a window too narrow for its least width beside the page", () => {
    expect(needsYouPanelLayout(600, 640)).toEqual({ width: 600, most: 600, fills: true });
  });
});

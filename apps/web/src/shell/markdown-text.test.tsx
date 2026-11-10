import { describe, expect, it } from "vitest";
import { documentOf, rendered } from "./markdown-text.fixtures.tsx";

describe("MarkdownText", () => {
  it("shows raw HTML as text, never as elements", () => {
    const page = document.createElement("div");
    page.innerHTML = rendered('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">');
    expect(page.querySelector("script, img, [onerror]")).toBeNull();
    expect(page.textContent).toContain("<script>alert(1)</script>");
  });

  it("drops a javascript: link's target", () => {
    const html = rendered("[open](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });
});

describe("MarkdownDocument", () => {
  it("shows raw HTML as text, never as elements", () => {
    const page = documentOf('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">');
    expect(page.querySelector("script, img, [onerror]")).toBeNull();
    expect(page.textContent).toContain("<script>alert(1)</script>");
  });

  it("drops a javascript: link's target and opens others in a new tab", () => {
    const page = documentOf("[open](javascript:alert(1)) [docs](https://example.com)");
    expect(page.innerHTML).not.toContain("javascript:");
    expect(page.querySelector('a[href="https://example.com"]')?.getAttribute("target")).toBe(
      "_blank",
    );
  });
});

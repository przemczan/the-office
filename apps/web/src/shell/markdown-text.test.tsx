import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "./markdown-text.tsx";

function rendered(text: string, inline = false): string {
  return renderToStaticMarkup(<MarkdownText text={text} inline={inline} />);
}

describe("MarkdownText", () => {
  it("renders a handover note's heading, list and code", () => {
    const html = rendered("# Done\n\n- added `sum`\n- tests pass");
    expect(html).toContain("<li>added <code>sum</code></li>");
    expect(html).not.toContain("<h1");
    expect(html).toContain("Done");
  });

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

  it("opens links in a new tab", () => {
    expect(rendered("[docs](https://example.com)")).toContain(
      '<a href="https://example.com" target="_blank" rel="noreferrer noopener">docs</a>',
    );
  });

  it("keeps an inline line free of paragraphs", () => {
    expect(rendered("ran `npm test`", true)).toBe(
      '<span class="markdown-text">ran <code>npm test</code></span>',
    );
  });
});

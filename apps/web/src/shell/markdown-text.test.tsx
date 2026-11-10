import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownDocument, MarkdownText } from "./markdown-text.tsx";

function rendered(text: string, inline = false): string {
  return renderToStaticMarkup(<MarkdownText text={text} inline={inline} />);
}

function documentOf(text: string): HTMLElement {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(<MarkdownDocument text={text} />);
  return page;
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

describe("MarkdownDocument", () => {
  it("keeps a file's headings as headings, by level", () => {
    const page = documentOf("# Plan\n\n## What changes\n\n### How");
    expect(page.querySelector("h1")?.textContent).toBe("Plan");
    expect(page.querySelector("h2")?.textContent).toBe("What changes");
    expect(page.querySelector("h3")?.textContent).toBe("How");
  });

  it("renders a table and a list", () => {
    const page = documentOf("| Day | Rows |\n| --- | --- |\n| Mon | 3 |\n\n- one\n- two");
    expect(page.querySelectorAll("table th")).toHaveLength(2);
    expect(page.querySelector("table td")?.textContent).toBe("Mon");
    expect(page.querySelectorAll("ul li")).toHaveLength(2);
  });

  it("joins a paragraph wrapped over lines into one", () => {
    const page = documentOf("One row\nper day.");
    expect(page.querySelectorAll("p")).toHaveLength(1);
    expect(page.querySelector("br")).toBeNull();
    expect(page.querySelector("p")?.textContent).toBe("One row\nper day.");
  });

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

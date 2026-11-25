import { afterEach, describe, expect, it } from "vitest";
import { selectionAsMarkdown } from "./markdown-copy.ts";

const TASK_ID = "8c7ba0c3-5174-4244-86c6-5ffcfadbebef";

/** A Markdown view holding `html`, as the app renders it. */
function view(html: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "markdown-text";
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

/** The text node holding `words` inside `root`. */
function textWith(root: Node, words: string): Text {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode())
    if (node.textContent?.includes(words)) return node as Text;
  throw new Error(`No text "${words}".`);
}

/** Selects from `from` to the end of `to`, each the start of a text's words. */
function select(root: Node, from: string, to: string): Selection {
  const start = textWith(root, from);
  const end = textWith(root, to);
  const range = document.createRange();
  range.setStart(start, start.data.indexOf(from));
  range.setEnd(end, end.data.indexOf(to) + to.length);
  const selection = document.getSelection();
  if (selection === null) throw new Error("No selection.");
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

function selectAll(root: Node): Selection {
  const selection = document.getSelection();
  if (selection === null) throw new Error("No selection.");
  selection.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(root);
  selection.addRange(range);
  return selection;
}

describe("copying rendered Markdown as Markdown", () => {
  afterEach(() => {
    document.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
  });

  it("writes a list back as a list, with its emphasis and a heading kept out of the outline", () => {
    const root = view(
      '<p class="markdown-heading" data-heading="2">Steps</p>' +
        "<ul><li><strong>Build</strong> it</li><li>Run <em>the</em> tests</li></ul>",
    );
    expect(selectionAsMarkdown(root, selectAll(root))?.markdown).toBe(
      "## Steps\n\n- **Build** it\n- Run _the_ tests",
    );
  });

  it("keeps a nested list nested and an ordered list numbered", () => {
    const root = view("<ol><li>One<ul><li>inner</li></ul></li><li>Two</li></ol>");
    expect(selectionAsMarkdown(root, selectAll(root))?.markdown).toBe("1. One\n   - inner\n2. Two");
  });

  it("keeps a code block's fence and language, without its Copy button", () => {
    const root = view(
      "<p>Run:</p>" +
        '<div class="markdown-copyable"><pre><code class="language-sh">npm test\nnpm run build\n</code></pre>' +
        '<button class="markdown-copy" aria-label="Copy the code">Copy</button></div>',
    );
    expect(selectionAsMarkdown(root, selectAll(root))?.markdown).toBe(
      "Run:\n\n```sh\nnpm test\nnpm run build\n```",
    );
  });

  it("writes a link and inline code back", () => {
    const root = view(
      '<p>See <a href="https://example.com" target="_blank">the docs</a> for <code>verify</code>.</p>',
    );
    expect(selectionAsMarkdown(root, selectAll(root))?.markdown).toBe(
      "See [the docs](https://example.com) for `verify`.",
    );
  });

  it("writes a record's chip back as the link it was written as", () => {
    const root = view(
      `<p>Look at <a class="record-mention" href="/tasks/${TASK_ID}" title="Task" ` +
        `data-markdown-href="/tasks/${TASK_ID}"><svg></svg>Fix the login</a> first.</p>`,
    );
    expect(selectionAsMarkdown(root, selectAll(root))?.markdown).toBe(
      `Look at [Fix the login](/tasks/${TASK_ID}) first.`,
    );
  });

  it("writes a table back as a table", () => {
    const root = view(
      "<table><thead><tr><th>Name</th><th>State</th></tr></thead>" +
        "<tbody><tr><td>Build</td><td><strong>Done</strong></td></tr></tbody></table>",
    );
    expect(selectionAsMarkdown(root, selectAll(root))?.markdown).toBe(
      "| Name  | State    |\n| ----- | -------- |\n| Build | **Done** |",
    );
  });

  it("keeps the formatting of a selection starting and ending inside one paragraph", () => {
    const root = view("<p>Hello <strong>bold world</strong> and more</p>");
    expect(selectionAsMarkdown(root, select(root, "llo", "bold"))?.markdown).toBe("llo **bold**");
  });

  it("keeps the list of a selection starting inside one of its items", () => {
    const root = view("<p>Intro</p><ul><li>First item</li><li>Second item</li></ul>");
    expect(selectionAsMarkdown(root, select(root, "item", "Second"))?.markdown).toBe(
      "- item\n- Second",
    );
  });

  it("keeps the fence of a selection inside a code block that spans its text", () => {
    const root = view(
      '<pre><code class="language-ts"><span>const a = 1;</span>\n<span>const b = 2;</span></code></pre>',
    );
    expect(selectionAsMarkdown(root, select(root, "a = 1", "const b"))?.markdown).toBe(
      "```ts\na = 1;\nconst b\n```",
    );
  });

  it("leaves to the browser a selection within one text, one with no formatting, or one reaching outside", () => {
    const root = view("<p>Plain words here</p><p>More plain words</p>");
    expect(selectionAsMarkdown(root, select(root, "words", "here"))).toBeUndefined();
    expect(selectionAsMarkdown(root, select(root, "words here", "More"))).toBeUndefined();
    const outside = document.createElement("p");
    outside.textContent = "Outside";
    document.body.append(outside);
    const range = document.createRange();
    range.setStart(textWith(root, "Plain"), 0);
    range.setEnd(textWith(outside, "Outside"), 3);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(selection && selectionAsMarkdown(root, selection)).toBeUndefined();
  });

  it("gives the selected HTML alongside", () => {
    const root = view("<p>Some <em>words</em></p>");
    expect(selectionAsMarkdown(root, selectAll(root))?.html).toBe("<p>Some <em>words</em></p>");
  });
});

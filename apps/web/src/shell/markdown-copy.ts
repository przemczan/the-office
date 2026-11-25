import { fromDom } from "hast-util-from-dom";
import { toMdast } from "hast-util-to-mdast";
import { gfmToMarkdown } from "mdast-util-gfm";
import { toMarkdown } from "mdast-util-to-markdown";

/** What a copy from the Markdown view puts on the clipboard. */
export interface CopiedMarkdown {
  /** The selection written back as Markdown, for `text/plain`. */
  readonly markdown: string;
  /** The selection as the page shows it, for `text/html`. */
  readonly html: string;
}

/**
 * The selection inside `root`, a rendered Markdown view, written back as Markdown: headings, lists,
 * emphasis, code, links (a record's chip as its link) and tables. Undefined when the browser's own
 * copy is as good or better: nothing selected, a selection reaching outside the view, one inside a
 * single text node, or one whose Markdown is just its words.
 */
export function selectionAsMarkdown(
  root: Element,
  selection: Selection,
): CopiedMarkdown | undefined {
  if (selection.rangeCount === 0 || selection.isCollapsed) return undefined;
  const ranges = Array.from({ length: selection.rangeCount }, (_, index) =>
    selection.getRangeAt(index),
  );
  if (
    ranges.some(
      (range) => !root.contains(range.startContainer) || !root.contains(range.endContainer),
    )
  )
    return undefined;
  if (ranges.every(isWithinOneText)) return undefined;
  const container = root.ownerDocument.createElement("div");
  for (const range of ranges) container.append(withAncestors(range, root));
  prepared(container);
  const markdown = markdownOf(container);
  if (markdown === "" || plainWords(markdown) === plainWords(selection.toString()))
    return undefined;
  return { markdown, html: container.innerHTML };
}

/** Markdown of an element holding rendered Markdown, after `prepared`. */
export function markdownOf(container: Element): string {
  const mdast = toMdast(fromDom(container));
  return toMarkdown(mdast, {
    extensions: [gfmToMarkdown()],
    bullet: "-",
    emphasis: "_",
    fence: "`",
    fences: true,
    rule: "-",
    // A line break is a new line, as typed in a message box.
    handlers: { break: () => "\n" },
  })
    .trim()
    .replace(/\n{3,}/g, "\n\n");
}

function isWithinOneText(range: Range): boolean {
  return range.startContainer === range.endContainer && range.startContainer.nodeType === 3;
}

/**
 * The range's contents inside clones of its common ancestor and the ancestors above it up to the
 * view, so a selection starting in a list item, a code block or a table keeps its list, its fence
 * and its language, or its table.
 */
function withAncestors(range: Range, root: Element): Node {
  let wrapped: Node = range.cloneContents();
  let ancestor: Node | null = range.commonAncestorContainer;
  if (ancestor.nodeType !== 1) ancestor = ancestor.parentNode;
  while (ancestor !== null && ancestor !== root && root.contains(ancestor)) {
    const shell = ancestor.cloneNode(false);
    shell.appendChild(wrapped);
    wrapped = shell;
    ancestor = ancestor.parentNode;
  }
  return wrapped;
}

/**
 * The rendered view made plain HTML again: no Copy buttons, a heading kept out of the outline back
 * as its heading, and a record's chip as a plain link to its page.
 */
function prepared(container: Element): void {
  const document = container.ownerDocument;
  for (const button of container.querySelectorAll(".markdown-copy, button")) button.remove();
  for (const heading of container.querySelectorAll<HTMLElement>("p[data-heading]")) {
    const level = Number(heading.dataset.heading);
    if (!Number.isInteger(level) || level < 1 || level > 6) continue;
    const replaced = document.createElement(`h${level}`);
    replaced.append(...heading.childNodes);
    heading.replaceWith(replaced);
  }
  for (const chip of container.querySelectorAll<HTMLElement>("[data-markdown-href]")) {
    const link = document.createElement("a");
    link.setAttribute("href", chip.dataset.markdownHref ?? "");
    link.textContent = chip.textContent;
    chip.replaceWith(link);
  }
}

/**
 * The text without its white space, to tell a selection with no formatting: browsers set blocks
 * apart in a selection's text differently.
 */
function plainWords(text: string): string {
  return text.replace(/\s+/g, "");
}

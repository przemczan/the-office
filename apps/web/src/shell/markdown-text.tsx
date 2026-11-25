import { useNavigate } from "@tanstack/react-router";
import { recordLinkOf } from "@the-office/contracts";
import type { ClipboardEvent, MouseEvent, ReactNode } from "react";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { CopyableCodeBlock, CopyableQuote } from "./markdown-copy-blocks.tsx";
import { selectionAsMarkdown } from "./markdown-copy.ts";
import "./markdown-text.css";
import { RecordMention } from "./record-mention.tsx";

/**
 * An Agent's "# Title" stays inside its message, out of the page's heading order; its level stays
 * on it, so copying writes it back as its heading.
 */
function MarkdownHeading({
  children,
  node,
}: { readonly children?: ReactNode } & ExtraProps): ReactNode {
  return (
    <p className="markdown-heading" data-heading={node?.tagName.slice(1)}>
      {children}
    </p>
  );
}

/**
 * Copying a selection of the view puts it on the clipboard as Markdown, and as the HTML selected,
 * so a message box it is pasted into keeps its formatting. A selection the browser copies as well
 * is left to it.
 */
function copiedAsMarkdown(event: ClipboardEvent<HTMLElement>): void {
  const selection = event.currentTarget.ownerDocument.getSelection();
  if (selection === null || event.clipboardData === null) return;
  let copied;
  try {
    copied = selectionAsMarkdown(event.currentTarget, selection);
  } catch {
    return;
  }
  if (copied === undefined) return;
  event.clipboardData.setData("text/plain", copied.markdown);
  event.clipboardData.setData("text/html", copied.html);
  event.preventDefault();
}

/**
 * A link to a Task, Initiative, Decision or Idea shows as its chip; one to another page of the app
 * opens it here; any other opens in a new tab.
 */
function MarkdownLink({
  href,
  children,
}: {
  readonly href?: string;
  readonly children?: ReactNode;
}): ReactNode {
  const record = href === undefined ? undefined : recordLinkOf(href);
  if (record) return <RecordMention link={record} written={children} />;
  if (href !== undefined && isAppPath(href))
    return <AppPageLink href={href}>{children}</AppPageLink>;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

/** A path on the app's own origin; `//host` is another site. */
function isAppPath(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

function AppPageLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children?: ReactNode;
}): ReactNode {
  const navigate = useNavigate();
  const opened = (event: MouseEvent<HTMLAnchorElement>): void => {
    // A modified or middle click keeps the browser's own way, such as a new tab.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    void navigate({ href });
  };
  return (
    <a href={href} onClick={opened}>
      {children}
    </a>
  );
}

const MESSAGE_PLUGINS = [remarkGfm, remarkBreaks];

const MESSAGE_COMPONENTS: Components = {
  h1: MarkdownHeading,
  h2: MarkdownHeading,
  h3: MarkdownHeading,
  h4: MarkdownHeading,
  h5: MarkdownHeading,
  h6: MarkdownHeading,
  a: MarkdownLink,
  pre: CopyableCodeBlock,
  blockquote: CopyableQuote,
};

const DOCUMENT_PLUGINS = [remarkGfm];

const DOCUMENT_COMPONENTS: Components = {
  a: MarkdownLink,
  pre: CopyableCodeBlock,
  blockquote: CopyableQuote,
};

/**
 * Text written by people and The Office, in Markdown. Raw HTML shows as text (there is no raw HTML
 * plugin) and unsafe link targets are dropped by the renderer's URL check. A link to a Task,
 * Initiative, Decision or Idea shows as a chip for it, one to another page of the app opens it in
 * place, and any other opens in a new tab. A code block or a quote has Copy, and copying a
 * selection copies it as Markdown. An inline one holds no blocks, for a line inside a row. A
 * single line break stays a break, as typed in a message.
 */
export function MarkdownText({
  text,
  inline = false,
}: {
  readonly text: string;
  readonly inline?: boolean;
}): ReactNode {
  const markdown = (
    <Markdown
      remarkPlugins={MESSAGE_PLUGINS}
      components={MESSAGE_COMPONENTS}
      disallowedElements={inline ? INLINE_ONLY : undefined}
      unwrapDisallowed={inline}
    >
      {text}
    </Markdown>
  );
  return inline ? (
    <span className="markdown-text" onCopy={copiedAsMarkdown}>
      {markdown}
    </span>
  ) : (
    <div className="markdown-text" onCopy={copiedAsMarkdown}>
      {markdown}
    </div>
  );
}

/**
 * A whole Markdown file, such as a document Attachment, with the safety rules and links of
 * `MarkdownText`. Its headings stay headings, and line breaks follow Markdown, so a paragraph
 * wrapped in the file reads as one.
 */
export function MarkdownDocument({ text }: { readonly text: string }): ReactNode {
  return (
    <div className="markdown-text markdown-document" onCopy={copiedAsMarkdown}>
      <Markdown remarkPlugins={DOCUMENT_PLUGINS} components={DOCUMENT_COMPONENTS}>
        {text}
      </Markdown>
    </div>
  );
}

/** Blocks unwrapped to their words when the text sits inside one line. */
// prettier-ignore
const INLINE_ONLY = [
  "p", "ul", "ol", "li", "blockquote", "pre", "table", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
];

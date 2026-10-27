import type { ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import "./markdown-text.css";

/** An Agent's "# Title" stays inside its message, out of the page's heading order. */
function MarkdownHeading({ children }: { readonly children?: ReactNode }): ReactNode {
  return <p className="markdown-heading">{children}</p>;
}

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

const COMPONENTS: Components = {
  h1: MarkdownHeading,
  h2: MarkdownHeading,
  h3: MarkdownHeading,
  h4: MarkdownHeading,
  h5: MarkdownHeading,
  h6: MarkdownHeading,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
};

/**
 * Text written by people and The Office, in Markdown. Raw HTML shows as text (there is no raw HTML
 * plugin) and unsafe link targets are dropped by the renderer's URL check. An inline one holds no
 * blocks, for a line inside a row. A single line break stays a break, as typed in a message.
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
      remarkPlugins={REMARK_PLUGINS}
      components={COMPONENTS}
      disallowedElements={inline ? INLINE_ONLY : undefined}
      unwrapDisallowed={inline}
    >
      {text}
    </Markdown>
  );
  return inline ? (
    <span className="markdown-text">{markdown}</span>
  ) : (
    <div className="markdown-text">{markdown}</div>
  );
}

/** Blocks unwrapped to their words when the text sits inside one line. */
// prettier-ignore
const INLINE_ONLY = [
  "p", "ul", "ol", "li", "blockquote", "pre", "table", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
];

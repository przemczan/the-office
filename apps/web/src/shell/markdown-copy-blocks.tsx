import { Icon, IconButton } from "@the-office/ui";
import type { ReactNode } from "react";
import type { ExtraProps } from "react-markdown";
import { useCopyText } from "./copy-text.ts";

type BlockProps = { readonly children?: ReactNode } & ExtraProps;
type MarkdownNode = NonNullable<ExtraProps["node"]>;
type MarkdownContent = MarkdownNode["children"][number];

/** A fenced code block, with Copy for its code as written. */
export function CopyableCodeBlock({ children, node }: BlockProps): ReactNode {
  // The Markdown keeps the newline that ends the fence's last line; the code doesn't hold it.
  const code = node === undefined ? "" : textOf(node).replace(/\n$/, "");
  return (
    <div className="markdown-copyable">
      <pre>{children}</pre>
      <CopyBlockButton text={code} label="Copy the code" />
    </div>
  );
}

/** A quote, with Copy for its words, its paragraphs a blank line apart. */
export function CopyableQuote({ children, node }: BlockProps): ReactNode {
  const words = node === undefined ? "" : blocksTextOf(node);
  return (
    <div className="markdown-copyable">
      <blockquote>{children}</blockquote>
      <CopyBlockButton text={words} label="Copy the quote" />
    </div>
  );
}

function CopyBlockButton({
  text,
  label,
}: {
  readonly text: string;
  readonly label: string;
}): ReactNode {
  const copyText = useCopyText();
  return (
    <IconButton
      className="markdown-copy"
      size="xs"
      icon={<Icon name="copy" size={14} />}
      label={label}
      onClick={() => copyText(text)}
    />
  );
}

/** Each block inside `node` as plain text, a blank line apart, as it would be pasted. */
function blocksTextOf(node: MarkdownNode): string {
  return node.children
    .filter((child) => child.type === "element")
    .map((child) => textOf(child).trim())
    .join("\n\n");
}

/** The words of a node. A line break is in them already: the text after a `br` starts with it. */
function textOf(node: MarkdownNode | MarkdownContent): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return "";
  return node.children.map(textOf).join("");
}

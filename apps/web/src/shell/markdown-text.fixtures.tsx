import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownDocument, MarkdownText } from "./markdown-text.tsx";

export function rendered(text: string, inline = false): string {
  return renderToStaticMarkup(<MarkdownText text={text} inline={inline} />);
}

export function documentOf(text: string): HTMLElement {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(<MarkdownDocument text={text} />);
  return page;
}

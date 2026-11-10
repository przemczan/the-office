/** Pulls the text out of a PDF, page by page. */
export abstract class PdfPages {
  /** Each page's text, in order, empty for a page with none; throws when the PDF can't be read. */
  abstract textOf(content: Uint8Array): Promise<readonly string[]>;
}

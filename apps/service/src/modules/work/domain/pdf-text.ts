/**
 * A PDF's text as it is kept and read by lines (spec §2.1): each page after a marker line naming
 * it, so a reader knows which page a line is on. Empty when no page has text, as in a scan.
 */
export function pdfTextOf(pages: readonly string[]): string {
  if (pages.every((page) => page.trim() === "")) return "";
  return pages
    .map((page, index) => `${pageMarker(index + 1, pages.length)}\n${page.trimEnd()}`)
    .join("\n");
}

function pageMarker(page: number, pageCount: number): string {
  return `--- Page ${page} of ${pageCount} ---`;
}

/**
 * A PDF of one page per entry, each page holding its text as one line in Helvetica; an empty entry
 * is a page with no text, as a scan's is.
 */
export function aPdf(pages: readonly string[]): Uint8Array {
  const pageIds = pages.map((_, index) => 4 + index * 2);
  const objects = new Map<number, string>([
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [
      2,
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    ],
    [3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"],
  ]);
  pages.forEach((text, index) => {
    const pageId = pageIds[index] ?? 0;
    const stream = text === "" ? "" : `BT /F1 12 Tf 72 720 Td (${escaped(text)}) Tj ET`;
    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`,
    );
    objects.set(pageId + 1, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  // Added in order of their ids, as the cross-reference table lists them.
  for (const [id, object] of objects) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${object}\nendobj\n`;
  }
  const xref = body.length;
  const count = objects.size + 1;
  const entries = Array.from(
    { length: objects.size },
    (_, index) => `${String(offsets[index + 1]).padStart(10, "0")} 00000 n \n`,
  ).join("");
  body += `xref\n0 ${count}\n0000000000 65535 f \n${entries}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

function escaped(text: string): string {
  return text.replace(/[\\()]/g, (character) => `\\${character}`);
}

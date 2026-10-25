import { ZipFile } from "yazl";

/** An entry to zip: a file with its text, a folder, or a link to `target`. */
export type ZipFixtureEntry =
  | { readonly file: string; readonly text: string }
  | { readonly folder: string }
  | { readonly link: string; readonly target: string };

/** A zip as Unix tools make it, with each entry's type in its mode. */
export async function aZip(entries: readonly ZipFixtureEntry[]): Promise<Uint8Array> {
  const zip = new ZipFile();
  for (const entry of entries) {
    if ("file" in entry) zip.addBuffer(Buffer.from(entry.text), entry.file);
    else if ("folder" in entry) zip.addEmptyDirectory(entry.folder);
    else zip.addBuffer(Buffer.from(entry.target), entry.link, { mode: 0o120777 });
  }
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * The zip as Windows tools make it: each entry made on MS-DOS, with `attributes` as its file
 * attributes and no Unix mode.
 */
export function madeOnWindows(zip: Uint8Array, attributes: number): Uint8Array {
  const bytes = Buffer.from(zip);
  for (let offset = 0; offset + 46 <= bytes.length; offset++) {
    // A central directory header: version made by at +4, external file attributes at +38.
    if (bytes.readUInt32LE(offset) !== 0x02014b50) continue;
    bytes.writeUInt16LE(20, offset + 4);
    bytes.writeUInt32LE(attributes, offset + 38);
  }
  return new Uint8Array(bytes);
}

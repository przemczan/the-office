import { ZipFile } from "yazl";

/** A zip of these files, by path, in order; a path ending in `/` is an empty folder. */
export async function aZip(
  files: Readonly<Record<string, string | Uint8Array>>,
): Promise<Uint8Array> {
  const zip = new ZipFile();
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith("/")) zip.addEmptyDirectory(path);
    else zip.addBuffer(Buffer.from(content), path);
  }
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

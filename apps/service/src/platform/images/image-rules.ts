export const IMAGE_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

export const IMAGE_SIZE_LIMIT = 2 * 1024 * 1024;
export const IMAGE_TOO_LARGE = `An image may be at most ${IMAGE_SIZE_LIMIT / 1024 / 1024} MB.`;

/** What bytes turned out to be: a kind of image, or why they can't be one, in the UI's words. */
export type ImageReading = { readonly mediaType: ImageMediaType } | { readonly problem: string };

/** Reads uploaded bytes by the rules every image The Office keeps follows. */
export function readImage(content: Uint8Array): ImageReading {
  if (content.byteLength === 0) return { problem: "The file is empty." };
  if (content.byteLength > IMAGE_SIZE_LIMIT) return { problem: IMAGE_TOO_LARGE };
  const mediaType = mediaTypeOf(content);
  return mediaType ? { mediaType } : { problem: "The file isn't a PNG, JPEG, WebP or SVG image." };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50];
const WEBP_SIGNATURE_OFFSET = 8;

/** What the bytes are, whatever the file's name or the browser says; undefined when none of the four. */
export function mediaTypeOf(content: Uint8Array): ImageMediaType | undefined {
  if (hasBytes(content, PNG_SIGNATURE)) return "image/png";
  if (hasBytes(content, JPEG_SIGNATURE)) return "image/jpeg";
  if (
    hasBytes(content, RIFF_SIGNATURE) &&
    hasBytes(content, WEBP_SIGNATURE, WEBP_SIGNATURE_OFFSET)
  ) {
    return "image/webp";
  }
  return hasSvgRoot(new TextDecoder().decode(content)) ? "image/svg+xml" : undefined;
}

function hasBytes(content: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => content[offset + index] === byte);
}

function hasSvgRoot(text: string): boolean {
  return /^<svg[\s/>]/.test(text.slice(afterProlog(text)));
}

/** Where the root element starts: past an XML declaration, comments and a doctype. */
function afterProlog(text: string): number {
  let position = 0;
  for (;;) {
    while (/\s/.test(text.charAt(position))) position += 1;
    const next = afterPrologPart(text, position);
    if (next === undefined) return position;
    position = next;
  }
}

function afterPrologPart(text: string, position: number): number | undefined {
  if (text.startsWith("<?", position)) return afterClosing(text, "?>", position);
  if (text.startsWith("<!--", position)) return afterClosing(text, "-->", position);
  if (text.startsWith("<!DOCTYPE", position)) return afterDoctype(text, position);
  return undefined;
}

/** A doctype may hold entities in square brackets, as Illustrator's do, with `>` inside them. */
function afterDoctype(text: string, position: number): number | undefined {
  const end = text.indexOf(">", position);
  const subset = text.indexOf("[", position);
  if (subset === -1 || subset > end) return end === -1 ? undefined : end + 1;
  const subsetEnd = text.indexOf("]", subset);
  return subsetEnd === -1 ? undefined : afterClosing(text, ">", subsetEnd);
}

function afterClosing(text: string, closing: string, position: number): number | undefined {
  const start = text.indexOf(closing, position);
  return start === -1 ? undefined : start + closing.length;
}

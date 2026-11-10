import type { Author } from "./author.js";

/** What an Attachment is attached to. */
export type AttachmentOwner =
  | { readonly kind: "idea"; readonly ideaId: string }
  | { readonly kind: "initiative"; readonly initiativeId: string }
  | { readonly kind: "task"; readonly taskId: string };

/**
 * Anything attached to an Idea, an Initiative or a Task: a document, an image, a file or a link
 * (spec §2.1).
 */
export type Attachment = AttachmentFields & (Link | StoredFile);

export type AttachmentKind = Attachment["kind"];

interface AttachmentFields {
  readonly id: string;
  readonly owner: AttachmentOwner;
  /** A file's name, or what a link is called. */
  readonly name: string;
  readonly addedBy: Author;
  readonly addedAt: Date;
}

interface Link {
  readonly kind: "link";
  readonly url: string;
}

/** A file kept in the Office data directory; which kind it is follows from the file itself. */
interface StoredFile {
  /** A document is Markdown, which The Office shows as text; an image it shows as a picture. */
  readonly kind: "document" | "image" | "file";
  readonly mediaType: string;
  /** In bytes. */
  readonly size: number;
  /** Whether it is a text file (`isText`), judged once as it is attached; a document always is. */
  readonly text: boolean;
}

/** A file as it is attached: as the user uploads it, or as an Agent attaches it. */
export interface NewFile {
  readonly name: string;
  readonly mediaType: string;
  readonly size: number;
  /** Whether its bytes are text, by `isText`. */
  readonly text: boolean;
}

/** A link as the user gives it. */
export interface NewLink {
  readonly name: string;
  readonly url: string;
}

export const ATTACHMENT_SIZE_LIMIT = 50 * 1024 * 1024;
/** A screenshot an Agent lists in its Stage's result may be at most this (research §8). */
export const SCREENSHOT_SIZE_LIMIT = 2 * 1024 * 1024;
const NAME_LENGTH = 200;

/**
 * Images The Office shows as pictures. SVG stays a file: it can carry script, and an Attachment is
 * opened on The Office's own origin.
 */
const IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** Media types by file extension, for a file an Agent attaches from its worktree. */
const MEDIA_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  log: "text/plain",
  csv: "text/csv",
  css: "text/css",
  js: "text/javascript",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  json: "application/json",
  html: "text/html",
  htm: "text/html",
  pdf: "application/pdf",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/** A file's media type by its extension; a file of any other kind is plain bytes. */
export function mediaTypeOf(fileName: string): string {
  const extension = /\.([^.]+)$/.exec(fileName.trim())?.[1]?.toLowerCase();
  return (extension && MEDIA_TYPES_BY_EXTENSION[extension]) ?? "application/octet-stream";
}

/** A file's kind, by its name for Markdown and by its media type for images. */
export function storedFileKind(file: Pick<NewFile, "name" | "mediaType">): StoredFile["kind"] {
  if (/\.(md|markdown)$/i.test(file.name.trim())) return "document";
  if (IMAGE_MEDIA_TYPES.has(file.mediaType.toLowerCase())) return "image";
  return "file";
}

/** How far into a file a NUL byte marks it as binary, as Git and ripgrep tell them apart. */
const BINARY_PROBE_BYTES = 8 * 1024;

/**
 * Whether a file's bytes are text (spec §2.1): valid UTF-8 throughout, with no NUL byte in its
 * first 8 KB, the NUL test being the one the API engine's Read and Grep use.
 */
export function isText(content: Uint8Array): boolean {
  if (content.subarray(0, BINARY_PROBE_BYTES).includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a file is a text file, given whether its bytes are text (`isText`): a document always
 * is, and an image or a PDF never is, as each is read and shown as what it is.
 */
export function isTextFile(
  file: { readonly kind: StoredFile["kind"]; readonly name: string; readonly mediaType: string },
  bytesAreText: boolean,
): boolean {
  if (file.kind === "document") return true;
  if (file.kind === "image" || isPdf(file)) return false;
  return bytesAreText;
}

/** A PDF, by its media type or its name, as a browser may upload one as plain bytes. */
export function isPdf(file: { readonly name: string; readonly mediaType: string }): boolean {
  return file.mediaType.toLowerCase() === "application/pdf" || /\.pdf$/i.test(file.name.trim());
}

/** An Attachment that is a file, kept in the Office data directory. */
export type StoredFileAttachment = Exclude<Attachment, { readonly kind: "link" }>;

/**
 * How an Agent reads a file Attachment (spec §6): a text file by its lines, an image as a picture,
 * a PDF by the lines of its text, and any other file not at all.
 */
export type FileReading = "picture" | "pdf-text" | "lines" | "unreadable";

export function fileReadingOf(file: StoredFileAttachment): FileReading {
  if (file.text) return "lines";
  if (file.kind === "image") return "picture";
  if (isPdf(file)) return "pdf-text";
  return "unreadable";
}

/**
 * Every Attachment on a line of its own, as an Agent reads a record, with the id it reads one by;
 * "None." for none.
 */
export function attachmentLines(attachments: readonly Attachment[]): string[] {
  if (attachments.length === 0) return ["None."];
  return attachments.map(
    (attachment) =>
      `- ${attachment.name} (${attachmentKindWords(attachment)}) · Attachment ${attachment.id}`,
  );
}

/**
 * What an Attachment is, in a few words: a link with its address, a file with its kind and size,
 * a file of no other kind that is text named a text file.
 */
export function attachmentKindWords(attachment: Attachment): string {
  if (attachment.kind === "link") return `link to ${attachment.url}`;
  const kind = attachment.kind === "file" && attachment.text ? "text file" : attachment.kind;
  return `${kind}, ${attachment.mediaType}, ${attachment.size} bytes`;
}

/** The link as it is kept: named by its URL when no name is given. */
export function trimmedNewLink(link: NewLink): NewLink {
  const url = link.url.trim();
  return { name: link.name.trim() || url, url };
}

export function newLinkProblems(link: NewLink): string[] {
  const problems = nameProblems(link.name);
  if (!isWebAddress(link.url)) {
    problems.push("A link is a web address starting http:// or https://.");
  }
  return problems;
}

export function newFileProblems(file: NewFile): string[] {
  const problems = nameProblems(file.name);
  if (/[\\/]/.test(file.name)) problems.push("A file's name can't contain / or \\.");
  if (file.size > ATTACHMENT_SIZE_LIMIT) {
    problems.push(`A file may be at most ${ATTACHMENT_SIZE_LIMIT / 1024 / 1024} MB.`);
  }
  return problems;
}

function nameProblems(name: string): string[] {
  const trimmed = name.trim();
  if (trimmed === "") return ["Give the Attachment a name."];
  if (trimmed.length > NAME_LENGTH) {
    return [`An Attachment's name may be at most ${NAME_LENGTH} characters.`];
  }
  // oxlint-disable-next-line no-control-regex -- control characters are what it refuses
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return ["An Attachment's name must be one line."];
  return [];
}

function isWebAddress(text: string): boolean {
  if (!URL.canParse(text)) return false;
  const { protocol } = new URL(text);
  return protocol === "http:" || protocol === "https:";
}

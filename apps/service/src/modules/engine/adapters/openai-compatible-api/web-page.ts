import { fetchFailure } from "../../../../platform/http/fetch-failure.js";
import TurndownService from "turndown";

/** How far WebFetch goes for a page. */
export interface WebPageLimits {
  /** For the whole fetch, redirects included. */
  readonly timeoutMs: number;
  /** The most of a page read; a larger one isn't read, as Claude Code refuses it. */
  readonly maxBytes: number;
  /** Redirects followed on the same host before the fetch gives up. */
  readonly maxRedirects: number;
  /** The most of the page's text the model reads; the rest is cut. */
  readonly maxCharacters: number;
}

/**
 * Claude Code's timeout, size cap and redirect limit. Claude Code hands up to 100 000 characters to
 * a small model; here the session's own model reads them, so less is kept for a local model's window.
 */
export const DEFAULT_WEB_PAGE_LIMITS: WebPageLimits = {
  timeoutMs: 60_000,
  maxBytes: 10 * 1024 * 1024,
  maxRedirects: 10,
  maxCharacters: 40_000,
};

/** What fetching a URL came to. */
export type WebPage =
  | { readonly kind: "page"; readonly url: URL; readonly text: string }
  /** A redirect to another host, which isn't followed: the model is told where it points. */
  | {
      readonly kind: "redirected";
      readonly from: URL;
      readonly to: URL;
      readonly status: string;
    }
  | { readonly kind: "failed"; readonly problem: string };

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

const HTML_TYPES: ReadonlySet<string> = new Set(["text/html", "application/xhtml+xml"]);

const TEXT_TYPES: ReadonlySet<string> = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-javascript",
  "application/ecmascript",
]);

const markdown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
}).remove(["script", "style", "noscript", "template", "iframe"]);

/**
 * Fetches `url` as Claude Code's WebFetch does: redirects on the same host followed, one to
 * another host reported instead, an HTML page turned into Markdown, text kept as it is, anything
 * else refused. Throws only the signal's reason when it aborts.
 */
export async function fetchWebPage(
  url: URL,
  limits: WebPageLimits,
  signal: AbortSignal,
): Promise<WebPage> {
  const fetchSignal = AbortSignal.any([signal, AbortSignal.timeout(limits.timeoutMs)]);
  let current = url;
  for (let redirects = 0; ; redirects += 1) {
    const response = await answerTo(current, fetchSignal, signal, limits.timeoutMs);
    if (response.kind === "failed") return response;
    const { answer } = response;
    const location = answer.headers.get("location");
    if (!REDIRECT_STATUSES.has(answer.status) || location === null) {
      return await pageOf(current, answer, limits, signal);
    }
    await answer.body?.cancel();
    const next = new URL(location, current);
    if (!isWebUrl(next)) {
      return {
        kind: "failed",
        problem: `${current} redirects to ${next}, which isn't http or https.`,
      };
    }
    if (!sameSite(current, next)) {
      return { kind: "redirected", from: current, to: next, status: statusOf(answer) };
    }
    if (redirects === limits.maxRedirects) {
      return {
        kind: "failed",
        problem: `${url} redirected more than ${limits.maxRedirects} times.`,
      };
    }
    current = next;
  }
}

/** A size in megabytes from one up, else in bytes. */
export function sizeInWords(bytes: number): string {
  const megabyte = 1024 * 1024;
  return bytes >= megabyte ? `${Math.round((bytes / megabyte) * 10) / 10} MB` : `${bytes} bytes`;
}

export function isWebUrl(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

type Answer =
  | { readonly kind: "answer"; readonly answer: Response }
  | Extract<WebPage, { readonly kind: "failed" }>;

async function answerTo(
  url: URL,
  fetchSignal: AbortSignal,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<Answer> {
  try {
    const answer = await fetch(url, {
      redirect: "manual",
      headers: { accept: "text/markdown, text/html, */*", "user-agent": "The-Office-WebFetch/1.0" },
      signal: fetchSignal,
    });
    return { kind: "answer", answer };
  } catch (error) {
    signal.throwIfAborted();
    return {
      kind: "failed",
      problem: `${url} could not be fetched: ${fetchFailure(error, timeoutMs)}`,
    };
  }
}

async function pageOf(
  url: URL,
  answer: Response,
  limits: WebPageLimits,
  signal: AbortSignal,
): Promise<WebPage> {
  if (!answer.ok) {
    await answer.body?.cancel();
    return { kind: "failed", problem: `${url} answered ${statusOf(answer)}.` };
  }
  const contentType = answer.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const html = HTML_TYPES.has(mediaType);
  if (!html && !isText(mediaType)) {
    await answer.body?.cancel();
    return {
      kind: "failed",
      problem: `WebFetch reads text and HTML pages; ${url} is ${mediaType}.`,
    };
  }
  let body: Uint8Array | undefined;
  try {
    body = await cappedBody(answer, limits.maxBytes);
  } catch (error) {
    signal.throwIfAborted();
    return {
      kind: "failed",
      problem: `${url} could not be read: ${fetchFailure(error, limits.timeoutMs)}`,
    };
  }
  if (body === undefined) {
    return {
      kind: "failed",
      problem: `${url} is larger than ${sizeInWords(limits.maxBytes)}; nothing of it was read.`,
    };
  }
  const text = decoded(body, contentType);
  return {
    kind: "page",
    url,
    text: cut(html ? markdown.turndown(text) : text, limits.maxCharacters),
  };
}

/** No type is taken as text, as a plain file server may send none. */
function isText(mediaType: string): boolean {
  return (
    mediaType === "" ||
    mediaType.startsWith("text/") ||
    TEXT_TYPES.has(mediaType) ||
    mediaType.endsWith("+json") ||
    mediaType.endsWith("+xml")
  );
}

/** The body, or undefined once it grows past `maxBytes`, read no further. */
async function cappedBody(answer: Response, maxBytes: number): Promise<Uint8Array | undefined> {
  if (answer.body === null) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of answer.body) {
    size += chunk.byteLength;
    if (size > maxBytes) {
      await answer.body.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function decoded(body: Uint8Array, contentType: string): string {
  const charset = /charset=["']?([^;"'\s]+)/i.exec(contentType)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

/** The start of `text`, at most `maxCharacters`, with a note of how much was cut. */
function cut(text: string, maxCharacters: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxCharacters) return trimmed;
  const left = trimmed.length - maxCharacters;
  return `${trimmed.slice(0, maxCharacters)}\n\n[${left} more characters of the page were cut.]`;
}

/** The same protocol, port and host, a leading `www.` aside, as Claude Code follows a redirect. */
function sameSite(from: URL, to: URL): boolean {
  return (
    from.protocol === to.protocol &&
    from.port === to.port &&
    withoutWww(from.hostname) === withoutWww(to.hostname)
  );
}

function withoutWww(hostname: string): string {
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

function statusOf(answer: Response): string {
  return `${answer.status} ${answer.statusText}`.trim();
}

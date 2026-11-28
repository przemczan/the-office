import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * What every response of The Office's port says to the browser (spec §6, "The web app's pages"):
 * no content type guessed, no address of The Office sent to another site, and no site framing it.
 * A response with a Content-Security-Policy of its own replaces this one: the web app's pages, an
 * opened file or image, an HTML Attachment's preview.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  // Not no-referrer, under which a browser sends a page's own POST with `Origin: null`.
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "frame-ancestors 'none'",
};

export function securityHeaders(): (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => void {
  return (_request, response, next) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
    next();
  };
}

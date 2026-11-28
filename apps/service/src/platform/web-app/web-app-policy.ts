import { createHash } from "node:crypto";

/** The other origins a page's form may post to, as `WebAppOptions.formTargets` gives them. */
export const WEB_APP_FORM_TARGETS = Symbol("WEB_APP_FORM_TARGETS");

/** A `<script>` without `src`: its text, as the browser hashes it. */
const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

/**
 * The CSP hash sources of `index.html`'s inline scripts, such as the one that sets the appearance
 * before the first paint, so they run and no other inline script does.
 */
export function inlineScriptHashesOf(html: string): readonly string[] {
  return [...html.matchAll(INLINE_SCRIPT)].map(([, script]) => hashSourceOf(script ?? ""));
}

function hashSourceOf(script: string): string {
  return `'sha256-${createHash("sha256").update(script).digest("base64")}'`;
}

/**
 * The Content-Security-Policy of the built web app's pages (spec §6, "The web app's pages"): its
 * own scripts, styles, fonts and workers only, with Vite's and the design system's inline styles;
 * images from The Office itself, `data:` (the QR codes) and `blob:` (an image before it is sent);
 * requests and WebSockets to its own origin; frames of its own (an HTML Attachment's preview); no
 * plugins, no `<base>`, forms posting only to itself and `formTargets` (GitHub's website, which
 * registering the GitHub App posts its manifest to), and no other site framing it. `blob:` workers
 * and `data:` or `blob:` fetches are Pixi's, for the Live view. The WebSocket's origin is named as
 * well as `'self'`, which older browsers don't match to `ws:`; an IPv6 Host, which a CSP host can't
 * be, is left to `'self'`.
 */
export function webAppContentSecurityPolicy(
  inlineScriptHashes: readonly string[],
  host: string | undefined,
  formTargets: readonly string[] = [],
): string {
  const webSockets =
    host === undefined || host.startsWith("[") ? [] : [`ws://${host}`, `wss://${host}`];
  return [
    "default-src 'self'",
    ["script-src 'self'", ...inlineScriptHashes].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    ["connect-src 'self'", ...webSockets, "data: blob:"].join(" "),
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    ["form-action 'self'", ...formTargets].join(" "),
    "frame-ancestors 'none'",
  ].join("; ");
}

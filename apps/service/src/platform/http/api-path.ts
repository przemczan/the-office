import { API_PATH } from "@the-office/contracts";

/**
 * A request URL's path as the API's routes match it: normalised (`..` and `.` resolved) and in
 * lower case, since Express matches routes regardless of case. Read only once `isAmbiguousPath`
 * let the URL through, as Express itself resolves nothing.
 */
export function apiRoutePathOf(url: string): string {
  return new URL(url, "http://localhost").pathname.toLowerCase();
}

/** Whether a request URL is the API's rather than the web app's. */
export function isApiPath(url: string): boolean {
  const pathname = apiRoutePathOf(url);
  return pathname === API_PATH || pathname.startsWith(`${API_PATH}/`);
}

/** A backslash, or a dot or a backslash escaped, in any case. */
const AMBIGUOUS_CHARACTERS = /\\|%5c|%2e/i;
/** A `.` or `..` segment. */
const DOT_SEGMENT = /(?:^|\/)\.{1,2}(?:\/|$)/;

/**
 * Whether a raw request URL's path (its query left out) is one a browser never sends, as it
 * resolves them itself: a backslash, an escaped dot or backslash, or a `.` or `..` segment. WHATWG
 * URL parsing reads `\` as `/` and resolves `..`, while Express routes the path as it came, so the
 * two would tell different paths apart.
 */
export function isAmbiguousPath(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0] ?? "";
  return AMBIGUOUS_CHARACTERS.test(path) || DOT_SEGMENT.test(path);
}

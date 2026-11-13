import { API_PATH } from "@the-office/contracts";

/**
 * A request URL's path as the API's routes match it: normalised (`..` and `.` resolved) and in
 * lower case, since Express matches routes regardless of case.
 */
export function apiRoutePathOf(url: string): string {
  return new URL(url, "http://localhost").pathname.toLowerCase();
}

/** Whether a request URL is the API's rather than the web app's. */
export function isApiPath(url: string): boolean {
  const pathname = apiRoutePathOf(url);
  return pathname === API_PATH || pathname.startsWith(`${API_PATH}/`);
}

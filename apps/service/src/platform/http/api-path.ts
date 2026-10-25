import { API_PATH } from "@the-office/contracts";

/** Whether a request URL is the API's rather than the web app's. */
export function isApiPath(url: string): boolean {
  const pathname = new URL(url, "http://localhost").pathname;
  return pathname === API_PATH || pathname.startsWith(`${API_PATH}/`);
}

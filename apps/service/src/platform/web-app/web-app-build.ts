import { createHash } from "node:crypto";

/**
 * Which build of the web app the service serves, so a tab opened on an earlier one can tell The
 * Office was updated (the event stream names it in each subscription's reply). `id` is undefined
 * while the service serves the web app's source, which Vite reloads itself, or no web app at all.
 */
export class WebAppBuild {
  static readonly NONE = new WebAppBuild(undefined);

  constructor(readonly id: string | undefined) {}
}

/**
 * A built web app's id, from its index.html: the page names the build's assets by their content's
 * hash, so it changes exactly when the build does.
 */
export function webAppBuildOf(indexHtml: string): WebAppBuild {
  return new WebAppBuild(createHash("sha256").update(indexHtml).digest("hex").slice(0, 16));
}

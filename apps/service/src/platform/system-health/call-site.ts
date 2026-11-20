/** Where the service's own code lives; a call site's path starts here. */
const SERVICE_SOURCE = "apps/service/src/";

/** The database layer runs every query, so its own frames never tell where one comes from. */
const DATABASE_LAYER = `${SERVICE_SOURCE}platform/database/`;

/** `at [async ][function ](location)` or `at [async ]location`, location `path:line:column`. */
const FRAME = /^\s*at (?:async )?(?:(?<name>.+?) \((?<inParentheses>.+)\)|(?<bare>.+))$/;
const LOCATION = /^(?<path>.+):(?<line>\d+):\d+$/;

/**
 * The first frame of `stack` in the service's own code outside the database layer, as
 * `apps/service/src/<file>:<line> (<function>)`, its path from the repository's root
 * (spec 5.2, System health, "Called from"); undefined when no frame is there. A frame from the
 * built service reads its source's path through `--enable-source-maps`.
 */
export function callSiteOf(stack: string | undefined): string | undefined {
  if (stack === undefined) return undefined;
  for (const line of stack.split("\n")) {
    const frame = FRAME.exec(line)?.groups;
    if (frame === undefined) continue;
    const location = LOCATION.exec(frame.inParentheses ?? frame.bare ?? "")?.groups;
    if (location?.path === undefined) continue;
    const path = location.path.replaceAll("\\", "/");
    const from = path.lastIndexOf(SERVICE_SOURCE);
    if (from === -1 || path.includes("/node_modules/")) continue;
    const sourcePath = path.slice(from);
    if (sourcePath.startsWith(DATABASE_LAYER)) continue;
    const site = `${sourcePath}:${location.line}`;
    return frame.name === undefined ? site : `${site} (${frame.name})`;
  }
  return undefined;
}

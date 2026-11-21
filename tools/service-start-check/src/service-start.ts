import { resolve } from "node:path";
import { parseArgs } from "node:util";

/**
 * The folder whose built service the check starts: `--root <folder>`, such as an unpacked Office
 * release, else the checkout the check runs from.
 */
export function serviceRootOf(args: readonly string[], checkout: string): string {
  const { values } = parseArgs({ args: [...args], options: { root: { type: "string" } } });
  return values.root === undefined ? checkout : resolve(values.root);
}

/** What the started service answered, and how it ended when told to stop. */
export interface ServiceStart {
  /** `/api/health`'s body; undefined when it never answered. */
  readonly health: string | undefined;
  /** The page at `/`; undefined when it never answered. */
  readonly page: string | undefined;
  readonly exit: ServiceExit;
}

/** As Node reports a child's end: a code, or the signal it ended by. */
export interface ServiceExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/** A service of its own, never a test instance of The Office, with its database up. */
export const HEALTHY = '{"database":"up","testInstance":false}';
/** The web app's page, from apps/web/index.html. */
export const WEB_APP_TITLE = "<title>The Office</title>";
const SIGTERM_STATUS = 143;

/** Every way the start fell short, in words for the check's output; none when it passed. */
export function serviceStartProblems(start: ServiceStart, serviceUrl: string): string[] {
  const problems: string[] = [];
  if (start.health !== HEALTHY) {
    problems.push(
      `Expected ${serviceUrl}/api/health to answer ${HEALTHY}, got ${shown(start.health)}.`,
    );
  }
  if (!start.page?.includes(WEB_APP_TITLE)) {
    problems.push(
      `Expected ${serviceUrl}/ to serve the web app's page, got ${shown(start.page?.slice(0, 200))}.`,
    );
  }
  const status = exitStatusOf(start.exit);
  if (status !== SIGTERM_STATUS) {
    problems.push(
      `The service ended with exit status ${status} on SIGTERM, not ${SIGTERM_STATUS}.`,
    );
  }
  return problems;
}

/**
 * The exit status a shell would show: the service ends by re-raising SIGTERM, which Node reports
 * as the signal, and a shell as 128 + its number.
 */
export function exitStatusOf(exit: ServiceExit): number | string {
  if (exit.code !== null) return exit.code;
  if (exit.signal === "SIGTERM") return SIGTERM_STATUS;
  return exit.signal ?? "unknown";
}

function shown(text: string | undefined): string {
  return text === undefined ? "no answer" : `'${text}'`;
}

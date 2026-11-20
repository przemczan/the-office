import type { SessionMcpServer } from "../../ports/session-options.js";

/** What stands for a Server value in a failure's words. */
const SERVER_VALUE_MARK = "[a Server value]";

/**
 * A failure's words hold a local server's standard error, which may print a Server value, a
 * secret among them; the Agent and the kept conversation never read one there.
 */
export function withoutServerValues(servers: readonly SessionMcpServer[], text: string): string {
  return servers
    .flatMap(({ launch }) =>
      Object.values(launch.transport === "stdio" ? launch.environmentVariables : launch.headers),
    )
    .filter((value) => value !== "")
    .reduce((redacted, value) => redacted.replaceAll(value, SERVER_VALUE_MARK), text);
}

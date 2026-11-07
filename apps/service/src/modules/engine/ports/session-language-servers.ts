import type { LanguageServer } from "../domain/language-servers.js";

/** What a new session gets of the language servers, and what the workstation lacks. */
export interface PreparedLanguageServers {
  readonly servers: readonly LanguageServer[];
  readonly leftOut: readonly LanguageServer[];
}

/** The language servers of each session, fixed as it starts, as its MCP servers are (spec §5.4). */
export abstract class SessionLanguageServers {
  /** Those found on `environment`'s PATH, kept for the session's resumes. */
  abstract prepare(
    sessionId: string,
    environment: Readonly<Record<string, string>>,
  ): Promise<PreparedLanguageServers>;

  /** Those the session started with; none for a session that kept no record. */
  abstract recorded(sessionId: string): Promise<readonly LanguageServer[]>;
}

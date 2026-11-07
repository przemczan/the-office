import type { LanguageServer } from "../../domain/language-servers.js";
import {
  SessionLanguageServers,
  type PreparedLanguageServers,
} from "../../ports/session-language-servers.js";

/** A scripted session runs no server, and its brief stays as its script has it. */
export class NoLanguageServers extends SessionLanguageServers {
  prepare(): Promise<PreparedLanguageServers> {
    return Promise.resolve({ servers: [], leftOut: [] });
  }

  recorded(): Promise<readonly LanguageServer[]> {
    return Promise.resolve([]);
  }
}

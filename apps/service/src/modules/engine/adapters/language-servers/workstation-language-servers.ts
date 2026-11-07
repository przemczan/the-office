import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { isOnPath } from "../../../../platform/os/program.js";
import { LANGUAGE_SERVERS, type LanguageServer } from "../../domain/language-servers.js";
import {
  SessionLanguageServers,
  type PreparedLanguageServers,
} from "../../ports/session-language-servers.js";

/** Beside the session's skills folder, so the session's forgetting removes it. */
const RECORD_FILE = "language-servers.json";

/** The workstation's language servers, each session's kept in its folder of the Office data. */
@Injectable()
export class WorkstationLanguageServers extends SessionLanguageServers {
  private readonly operatingSystem = currentOperatingSystem();

  constructor(private readonly officeData: OfficeDataDirectory) {
    super();
  }

  async prepare(
    sessionId: string,
    environment: Readonly<Record<string, string>>,
  ): Promise<PreparedLanguageServers> {
    const found = await Promise.all(
      LANGUAGE_SERVERS.map(({ command }) => isOnPath(command, environment, this.operatingSystem)),
    );
    const servers = LANGUAGE_SERVERS.filter((_, index) => found[index]);
    const folder = this.sessionFolder(sessionId);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await writeFile(join(folder, RECORD_FILE), JSON.stringify(servers), { mode: 0o600 });
    return { servers, leftOut: LANGUAGE_SERVERS.filter((server) => !servers.includes(server)) };
  }

  async recorded(sessionId: string): Promise<readonly LanguageServer[]> {
    const record = await readFile(join(this.sessionFolder(sessionId), RECORD_FILE), "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "[]";
        throw error;
      },
    );
    // Only this class writes the file.
    return JSON.parse(record) as LanguageServer[];
  }

  private sessionFolder(sessionId: string): string {
    return join(this.officeData.folder("sessions"), sessionId);
  }
}

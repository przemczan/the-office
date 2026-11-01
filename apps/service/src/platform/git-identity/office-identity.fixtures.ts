import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfficeDataDirectory } from "../office-data/office-data-directory.js";
import { HostKeyScanner } from "./host-key-scanner.js";
import { IdentityFolder } from "./identity-folder.js";
import { OfficeIdentity } from "./office-identity.js";
import { OfficeKnownHosts } from "./office-known-hosts.js";
import { OfficeSshKey } from "./office-ssh-key.js";

/** A scanner for tests that confirm no host. */
export class NoHostKeyScanner extends HostKeyScanner {
  scan(): Promise<never> {
    return Promise.reject(new Error("No host is scanned here."));
  }
}

/** Nothing listens on the discard port, so a test that reaches GitHub's list unasked fails. */
const UNREACHABLE_META_URL = "http://127.0.0.1:9/meta";

/**
 * The Office identity on an Office data directory of its own. Nothing is written there until a
 * command reaches an ssh remote, so a test of local remotes needs no folder made.
 */
export function officeIdentityForTests(
  officeData: string = join(tmpdir(), `office-identity-${randomUUID()}`),
  gitHubMetaUrl: string = UNREACHABLE_META_URL,
): OfficeIdentity {
  const folder = new IdentityFolder(new OfficeDataDirectory(officeData));
  return new OfficeIdentity(
    new OfficeSshKey(folder),
    new OfficeKnownHosts(folder, new NoHostKeyScanner(), gitHubMetaUrl),
  );
}

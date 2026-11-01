import { Module } from "@nestjs/common";
import { HostKeyScanner } from "./host-key-scanner.js";
import { IdentityFolder } from "./identity-folder.js";
import { OfficeGitHome } from "./office-git-home.js";
import { OfficeIdentity } from "./office-identity.js";
import { GITHUB_META_URL, OfficeKnownHosts } from "./office-known-hosts.js";
import { OfficeSshKey } from "./office-ssh-key.js";
import { SshKeyscan } from "./ssh-keyscan.js";

/** The Office identity, for a module that runs git or shows the identity. */
@Module({
  providers: [
    IdentityFolder,
    OfficeSshKey,
    OfficeKnownHosts,
    OfficeGitHome,
    OfficeIdentity,
    { provide: HostKeyScanner, useClass: SshKeyscan },
    { provide: GITHUB_META_URL, useValue: "https://api.github.com/meta" },
  ],
  exports: [OfficeIdentity, OfficeSshKey, OfficeKnownHosts],
})
export class GitIdentityModule {}

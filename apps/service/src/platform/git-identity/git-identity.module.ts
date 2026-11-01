import { type DynamicModule, Module, type ModuleMetadata, type Type } from "@nestjs/common";
import { GitCredentialHelper } from "./git-credential-helper.js";
import { GitHubUserToken } from "./github-user-token.js";
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
    GitCredentialHelper,
    OfficeIdentity,
    { provide: HostKeyScanner, useClass: SshKeyscan },
    { provide: GITHUB_META_URL, useValue: "https://api.github.com/meta" },
  ],
  exports: [OfficeIdentity, OfficeSshKey, OfficeKnownHosts],
})
export class GitIdentityModule {}

export interface GitHubUserTokenOptions {
  /** The modules that provide `gitHubUserToken`. */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly gitHubUserToken: Type<GitHubUserToken>;
}

/**
 * Binds the Office identity's `GitHubUserToken` in the composition root. Global, so the one
 * `GitIdentityModule` every module imports finds it.
 */
@Module({})
export class GitHubUserTokenModule {
  static register({ imports, gitHubUserToken }: GitHubUserTokenOptions): DynamicModule {
    return {
      module: GitHubUserTokenModule,
      global: true,
      imports,
      providers: [{ provide: GitHubUserToken, useExisting: gitHubUserToken }],
      exports: [GitHubUserToken],
    };
  }
}

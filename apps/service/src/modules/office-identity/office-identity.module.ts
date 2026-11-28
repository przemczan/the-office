import { type DynamicModule, Module, type ModuleMetadata, type Type } from "@nestjs/common";
import { GitCredentialHelper } from "./application/git-credential-helper.js";
import { GITHUB_SITE, GitHubSite } from "../../platform/config/github-site.js";
import { GitHubUserToken } from "./ports/github-user-token.js";
import { HostKeyScanner } from "./ports/host-key-scanner.js";
import { IdentityFolder } from "./application/identity-folder.js";
import { OfficeGitHome } from "./application/office-git-home.js";
import { OfficeIdentity } from "./application/office-identity.js";
import { OfficeKnownHosts } from "./application/office-known-hosts.js";
import { OfficeSshKey } from "./application/office-ssh-key.js";
import { SshKeyscan } from "./adapters/ssh/ssh-keyscan.js";

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
    {
      // Where the bound user token says GitHub is, so one value decides every GitHub remote.
      provide: GitHubSite,
      useFactory: (gitHubUserToken?: GitHubUserToken): GitHubSite => gitHubUserToken ?? GITHUB_SITE,
      inject: [{ token: GitHubUserToken, optional: true }],
    },
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

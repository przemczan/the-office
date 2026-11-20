import { Module, type DynamicModule } from "@nestjs/common";
import { GitHubRestApi } from "./adapters/github/github-rest-api.js";
import { GitHubAppController } from "./adapters/http/github-app.controller.js";
import { GitHubController } from "./adapters/http/github.controller.js";
import { PostgresGitHubApp } from "./adapters/postgres/postgres-github-app.js";
import { PostgresGitHubSignIn } from "./adapters/postgres/postgres-github-sign-in.js";
import { GitHubWebEvents } from "./adapters/websocket/github-web-events.js";
import { AppRegistration } from "./application/app-registration.js";
import { GitHubAccess } from "./application/github-access.js";
import { GitHubIdentities } from "./application/github-identities.js";
import { GitHubPermissions } from "./application/github-permissions.js";
import { GitHubPullRequests } from "./application/github-pull-requests.js";
import { GitHubSignIn } from "./application/github-sign-in.js";
import { GITHUB_URLS, GitHubUrls } from "./application/github-urls.js";
import { SignInChanges } from "./application/sign-in-changes.js";
import { GitHubApi } from "./ports/github-api.js";
import { GitHubAppRepository } from "./ports/github-app-repository.js";
import { GitHubSignInRepository } from "./ports/github-sign-in-repository.js";

/**
 * Sign in with GitHub (spec §5.3): the GitHub App registered by its manifest, the user's sign-in
 * through it, their token in use, and pull requests opened as them; and who a user of The Office is
 * on GitHub, for Continue with GitHub, through the same App. GitHub's base URLs are given, so tests talk to a fake GitHub server instead.
 */
@Module({})
export class GitHubModule {
  static register(urls: GitHubUrls = GITHUB_URLS): DynamicModule {
    return {
      module: GitHubModule,
      controllers: [GitHubAppController, GitHubController],
      providers: [
        { provide: GitHubUrls, useValue: urls },
        { provide: GitHubApi, useClass: GitHubRestApi },
        { provide: GitHubAppRepository, useClass: PostgresGitHubApp },
        { provide: GitHubSignInRepository, useClass: PostgresGitHubSignIn },
        AppRegistration,
        SignInChanges,
        GitHubSignIn,
        GitHubAccess,
        GitHubIdentities,
        GitHubPullRequests,
        GitHubPermissions,
        GitHubWebEvents,
      ],
      exports: [GitHubAccess, GitHubIdentities, GitHubPullRequests],
    };
  }
}

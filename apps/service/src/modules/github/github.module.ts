import { Module, type DynamicModule } from "@nestjs/common";
import { GitHubRestApi } from "./adapters/github/github-rest-api.js";
import { GitHubAppController } from "./adapters/http/github-app.controller.js";
import { PostgresGitHubApp } from "./adapters/postgres/postgres-github-app.js";
import { GitHubWebEvents } from "./adapters/websocket/github-web-events.js";
import { AppRegistration } from "./application/app-registration.js";
import { GITHUB_URLS, GitHubUrls } from "./application/github-urls.js";
import { GitHubApi } from "./ports/github-api.js";
import { GitHubAppRepository } from "./ports/github-app-repository.js";

/**
 * Sign in with GitHub (spec §5.3): the GitHub App registered by its manifest. GitHub's base URLs
 * are given, so tests talk to a fake GitHub server instead.
 */
@Module({})
export class GitHubModule {
  static register(urls: GitHubUrls = GITHUB_URLS): DynamicModule {
    return {
      module: GitHubModule,
      controllers: [GitHubAppController],
      providers: [
        { provide: GitHubUrls, useValue: urls },
        { provide: GitHubApi, useClass: GitHubRestApi },
        { provide: GitHubAppRepository, useClass: PostgresGitHubApp },
        AppRegistration,
        GitHubWebEvents,
      ],
    };
  }
}

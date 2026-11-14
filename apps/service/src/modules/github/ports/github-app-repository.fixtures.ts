import type { GitHubApp } from "../domain/github-app.js";
import { GitHubAppRepository } from "./github-app-repository.js";

/** The registered App in memory, for tests that don't need the database. */
export class GitHubAppForTests extends GitHubAppRepository {
  app: GitHubApp | undefined;

  read(): Promise<GitHubApp | undefined> {
    return Promise.resolve(this.app);
  }

  replace(app: GitHubApp): Promise<void> {
    this.app = app;
    return Promise.resolve();
  }
}

/** Replaces the registered App with `app`, wherever the github module is imported. */
export function registeredGitHubAppForTests(app: GitHubApp): {
  readonly provide: typeof GitHubAppRepository;
  readonly useValue: GitHubAppRepository;
} {
  const apps = new GitHubAppForTests();
  apps.app = app;
  return { provide: GitHubAppRepository, useValue: apps };
}

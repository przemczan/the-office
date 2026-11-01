import type { GitHubApp } from "../domain/github-app.js";

/** Where the registered GitHub App is kept: one at a time. */
export abstract class GitHubAppRepository {
  /** Undefined until the App is registered. */
  abstract read(): Promise<GitHubApp | undefined>;
  abstract replace(app: GitHubApp): Promise<void>;
}

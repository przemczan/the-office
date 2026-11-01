/**
 * The GitHub App behind Sign in with GitHub, as The Office keeps it once registered. Its private
 * key, client secret and webhook secret are never kept: device-flow tokens refresh without them.
 */
export interface GitHubApp {
  readonly clientId: string;
  readonly slug: string;
  /** The login of the account the App was registered on. */
  readonly owner: string;
}

/** What the manifest asks GitHub for (spec §5.5, the Office identity). */
export interface GitHubAppManifest {
  readonly url: string;
  readonly redirect_url: string;
  readonly description: string;
  readonly public: false;
  readonly default_permissions: Readonly<Record<string, "read" | "write">>;
}

/**
 * The manifest of the App registered from The Office at `officeOrigin`, GitHub sending the
 * browser back to `redirectUrl`. It leaves out a name, which is unique on GitHub, so the user
 * picks one on GitHub's page, and a webhook, which The Office never receives. Device Flow can't
 * be asked for in a manifest; it is a setting of the App once registered.
 */
export function gitHubAppManifest(officeOrigin: string, redirectUrl: string): GitHubAppManifest {
  return {
    url: officeOrigin,
    redirect_url: redirectUrl,
    description: "Sign in with GitHub for The Office: clones, fetches, pushes and pull requests.",
    public: false,
    default_permissions: {
      metadata: "read",
      contents: "write",
      pull_requests: "write",
      workflows: "write",
    },
  };
}

/** Why registering the App failed, in the words Settings › Office identity shows. */
export class GitHubAppRegistrationFailed extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "GitHubAppRegistrationFailed";
  }
}

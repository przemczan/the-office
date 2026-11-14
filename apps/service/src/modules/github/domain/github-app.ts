/**
 * The GitHub App behind Sign in with GitHub, as The Office keeps it once registered. Its private
 * key and webhook secret are never kept. The client secret is: GitHub asks for it to exchange a
 * sign-in's code and to refresh the token. Like an API key, it never leaves the service.
 */
export interface GitHubApp {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly slug: string;
  /** The login of the account the App was registered on. */
  readonly owner: string;
}

/** What the manifest asks GitHub for (spec §5.5, the Office identity). */
export interface GitHubAppManifest {
  readonly url: string;
  readonly redirect_url: string;
  readonly callback_urls: readonly string[];
  readonly request_oauth_on_install: false;
  readonly description: string;
  readonly public: false;
  readonly default_permissions: Readonly<Record<string, "read" | "write">>;
}

/**
 * Where GitHub sends the browser back after registering the App, after Sign in with GitHub, and
 * after Continue with GitHub, at each address a user signs in to The Office from.
 */
export interface ManifestReturnUrls {
  readonly registered: string;
  readonly signedIn: string;
  readonly identitySignedIn: readonly string[];
}

/**
 * The manifest of the App registered from The Office at `officeOrigin`. Sign in with GitHub's
 * callback comes first: GitHub sends a `redirect_uri` it doesn't list to the first one, whose page
 * then says which URL to add. It leaves out a name,
 * which is unique on GitHub, so the user picks one on GitHub's page, and a webhook, which The
 * Office never receives. Signing in on install stays off: GitHub would then send the browser to
 * the callback without the state and PKCE The Office's own sign-in sends.
 */
export function gitHubAppManifest(
  officeOrigin: string,
  returnUrls: ManifestReturnUrls,
): GitHubAppManifest {
  return {
    url: officeOrigin,
    redirect_url: returnUrls.registered,
    callback_urls: [...new Set([returnUrls.signedIn, ...returnUrls.identitySignedIn])],
    request_oauth_on_install: false,
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

# GitHub: module map

**Owns:** Sign in with GitHub (spec §5.3, §5.5): the GitHub App the user registers from Settings › Office identity by GitHub's manifest flow, kept in one row (`github_app`: Client ID, client secret, slug, owner), and the user's sign-in through it (`github_sign_in`: login, tokens and their expiries, or why The Office signed the user out). Registering: `GET /github/app/manifest` hands the browser a form for GitHub's new-App page with an unguessable state (`PendingStates`, GitHub's hour); GitHub sends the browser back to `GET /github/app/registered?code&state`, which converts the code (`POST /app-manifests/{code}/conversions`), replaces the App, publishes `GitHubAppRegistered` and redirects to Settings › Office identity, a failure carrying why in `registrationFailed`. Signing in (`GitHubSignIn`, GitHub's web flow for an App's user token): `GET /github` gives the state with the App's slug, owner and install page (`appInstallUrl`, on the website URL), never a secret; `POST /github/sign-in` gives GitHub's authorize URL (state, PKCE S256, `offline_access`); GitHub sends the browser back to `GET /github/sign-in/callback`, which exchanges the code with the client secret and verifier, keeps the tokens, publishes `GitHubSignedIn` and redirects to Settings, a failure carrying why in `signInFailed`. `DELETE /github/sign-in` forgets the tokens (`GitHubSignedOut`). `GET /github` gives the state. The token in use (`GitHubAccess`, the public entry): `userToken()` gives it for one command, refreshing it first when it expires within fifteen minutes (`grant_type=refresh_token` with the client secret, both tokens replaced); a refresh GitHub refuses, or a refresh token past its expiry, signs the user out with a reason (`GitHubSignedOut`), and GitHub unreachable fails the command keeping the sign-in. `GET /github/repositories` lists the repositories of the App's installations the user reaches (`GET /user/installations`, `…/{id}/repositories`, every page by the `Link` header's `next`, suspended installations left out), each with its default branch, Private, when it was last pushed (`pushed_at`, null when GitHub has none) and its description (empty when it has none), 409 while signed out, 502 when GitHub fails. Pull requests (`GitHubPullRequests`, the public entry, for Projects' Push + PR): `whyCannotOpen(remoteUrl)` says, without asking GitHub or refreshing, that a remote isn't a repository on GitHub's website (`repositoryOnGitHubOf`: an http(s) URL by `webUrl`'s origin, ssh by its host) or that no one is signed in; `open` posts `POST /repos/{owner}/{repo}/pulls` with the user token and, on a 422, gives the open one for `head=owner:branch` into the base (`GET …/pulls?state=open`), otherwise GitHub's refusal in words (`PullRequestNotOpened`), answering `{ number, url }` (`OpenedPullRequestOnGitHub`). Reading them, for Projects' list of the pull requests The Office opened: `reaches(remoteUrl)` (on GitHub's website, asking no one); `whyCannotRead(remoteUrl)`, never throwing: not on GitHub, no one signed in, or the token couldn't be renewed now (`GitHubAccessFailed`'s reason); `openPullRequests(remoteUrl)` (`GET …/pulls?state=open`, every page: `OpenPullRequestOnGitHub`, branch, base branch and both commits); `status(remoteUrl, number)` (`GET …/pulls/{n}`, then the head commit's `GET …/commits/{sha}/check-runs`, every page, and `…/status`'s `statuses`: `PullRequestStatusOnGitHub`), mapped by `domain/pull-request-status.ts` into host-neutral words (`GitHubPullRequestState` open/merged/closed by `merged_at`, `GitHubChecks` failing over pending over passing over none, unknown when GitHub refuses the checks with 403 or 404, `GitHubMergeable` yes/conflicts/unknown while `mergeable` is null); both throw `NotSignedInWithGitHub` while signed out and `GitHubAccessFailed` otherwise. The App's permissions (`GitHubPermissions`): `REQUIRED_PERMISSIONS` (`domain/github-app.ts`, also the manifest's `default_permissions`: metadata read, contents, pull requests, workflows and actions write, checks and statuses read), compared with what each installation that isn't suspended granted (`GET /user/installations`' `permissions`, a higher level satisfying a lower); `lacking()` answers the missing ones once each, the App's permission settings (`/organizations/{owner}/settings/apps/{slug}/permissions` or `/settings/apps/{slug}/permissions`) and each lacking installation's page to accept them on, or undefined when nothing is missing, no one is signed in or GitHub can't be asked (logged at warn). Kept five minutes, dropped on `GitHubSignedIn`, `GitHubSignedOut` and `GitHubAppRegistered`. `GET /github` gives them as the signed-in state's `permissions` (null when none are missing); `POST /github/permissions/check` (Check again) drops them, reads them again, publishes `GitHubPermissionsChecked` (`github.changed` on the web) and answers the state. Continue with GitHub (`GitHubIdentities`, the public entry, which the users module's `GitHubIdentityProvider` calls): who a user of The Office is on GitHub, through the same App by its user authorization flow: `isAvailable` (an App registered), `authorizeUrl` with the caller's state, PKCE S256 and callback URL and no scope (so no `offline_access`), and `identityOf`, which exchanges the code (`exchangeSignInCode`), reads `GET /user` (`userOf`: GitHub's numeric id and login) and revokes that one token (`DELETE /applications/{client_id}/token` with the client ID and secret by Basic auth, never `/grant`; a failed revoke is logged without the token), answering `{ subject, name }`. It never reads or writes `github_sign_in`, never runs on `SignInChanges` and publishes nothing. The manifest's `callback_urls` list Sign in with GitHub's callback first, then `/api/sign-in/github/callback` on the registering origin and on `OFFICE_PUBLIC_ADDRESS` when set; at the public address the origin is the configured one (`officeOriginOf` with `OfficeAddresses`), since behind the proxy requests look like plain HTTP.

**Talks to:** the platform's Office identity, which `app.module.ts` binds to `GitHubAccess` as its `GitHubUserToken` (`webUrl`, `isSignedIn`, `userToken`), so git gets the token through the identity's credential helper; GitHub, on the base URLs `GitHubModule.register(urls)` is given (`GitHubUrls`, GitHub's own by default), through the `GitHubApi` port (`GitHubRestApi`; the token endpoint is on the web base, the REST API on the API base); the web, through `github.changed`. Tests use `FakeGitHub` from `index.fixtures.ts`: one server on 127.0.0.1 standing for GitHub's website and its REST API (under `/api/v3`, so a client dropping its base's path is caught): registering an App from a posted manifest, converting each code once, the authorize page and token endpoint of the web sign-in and the refresh (each refresh token works once, and ends the user token handed out with it), `GET /user` (each login with an id of its own, `userIdOf`), revoking one user token (`revokedTokens`), the scope each authorize visit asked for (`authorizeScopes`), an App registered without the manifest flow (`registerApp`) and a callback URL added to it later (`addCallbackUrl`), and the installations and their repositories (`FakeInstallations`: `install`, each repository's `pushedAt` and `description` if a test names them, GitHub's `per_page`/`page` and absolute `Link`), each installation's granted `permissions` (`FAKE_DEFAULT_PERMISSIONS`, the four before checks were read, unless `install` names others with its account's `accountType`; `grant(account, permissions)` accepts more), and the pull requests of installed repositories (`FakePullRequests`: 404 for a repository no installation reaches, 422 for one already open or `withoutCommits`; each with its head and base `sha`, `mergeable` true and no checks until a test changes them with `setChecks(repository, number, "passing" | "failing" | "pending" | "none" | { runs, statuses })` on its head commit, `setMergeable`, `merge`, `close` and `pushHead`, which moves the head to a commit without checks; `checksRefused` answers a repository's checks 403). The pull request list, a pull request and a commit's check runs and status answer with an ETag and 304 on a matching `If-None-Match`, recorded in `notModified`; `issueUserToken` hands out a token without signing in. `signedInWithGitHubForTests(token)` replaces the kept sign-in and `registeredGitHubAppForTests(app)` the registered App, for tests that check the token goes nowhere. The fake also publishes GitHub's ssh host key at `GET /api/v3/meta` and starts on a given port, its repositories' clone URLs on its website unless `gitUrl` names another host; `adapters/github/serve-fake-github.fixtures.ts` runs it as a program of its own (port and `gitUrl` as its arguments, one line printed once it listens), installed on by `POST /_fake/installations` (`FAKE_INSTALLATIONS_CONTROL_PATH`, not GitHub's: `{ account, accountType?, permissions?, repositories }`), its pull requests changed by `POST /_fake/pull-requests` (`FAKE_PULL_REQUESTS_CONTROL_PATH`: `{ action: "setChecks", repository, number, checks }`, `{ action: "setMergeable", repository, number, mergeable: true | false | null }`, `{ action: "merge" | "close" | "pushHead", repository, number }` or `{ action: "refuseChecks", repository, refused? }`, 404 for a pull request it didn't open) and permissions granted by `POST /_fake/permissions` (`FAKE_PERMISSIONS_CONTROL_PATH`: `{ account, permissions }`), each answering 204, since such a test reaches it only over HTTP for the end-to-end service, which apps/web/e2e starts with tsx. `app.module.ts` gives `register` the Office config's `OFFICE_GITHUB_URL` and `OFFICE_GITHUB_API_URL`.

**Traps:** the conversion's answer holds the App's private key and webhook secret, and token answers hold tokens. `GitHubRestApi` parses only what is kept, and a failure names GitHub's status, never its body (except a pull request's 422, whose validation errors' `message`s GitHub writes for the user), so no secret reaches a log or an event; the client secret and tokens are never in an HTTP answer or a URL (sent in the body). GitHub refuses token requests with HTTP 200 and an `error`, and answers form-encoded without `Accept: application/json`. Registering the App again ends the sign-in (tokens of the App before won't refresh), and a sign-in begun under the App before fails. The callback URL and `redirect_url` are built from the address the request reached The Office on; signing in from another address than the one the App was registered from gets `redirect_uri_mismatch`. GitHub sends any mismatch to the App's first callback URL, Sign in with GitHub's, Continue with GitHub's included: `GitHubSignIn.complete` words a mismatch with a state it didn't issue as "add this address's callback URL" (a browser not signed in gets the guard's 401 there instead). Continue with GitHub's tokens are revoked at once and only one by one: `/grant`, or the user revoking the App's authorization on GitHub, would end the git identity's token too when it is the same GitHub user. Every read of the token and every sign-in change runs one at a time on `SignInChanges`, shared by `GitHubSignIn` and `GitHubAccess`: GitHub ends both tokens on each refresh, so two refreshes at once would sign the user out, and a token isn't kept after the sign-out or new App that came in meanwhile. A caller waiting behind a refresh re-reads the kept tokens rather than refreshing again. `Link` pages are followed only on the API's own origin, so the token goes nowhere else. Calls to GitHub time out after 30 seconds, so a hung refresh can't hold up every git command. `GitHubRestApi` makes its reads conditional: it keeps up to 500 answers (what it parsed, never the whole body) by the token's SHA-256 and the URL, sends their ETag as `If-None-Match` and reuses the kept answer on a 304, which costs no rate limit; so a page read every few seconds stays cheap, and its own instance holds them, the one provider per module. The combined status' own `state` is `pending` for a commit with no status at all, so only its `statuses` are read. A check run concluding `stale` or a conclusion GitHub may add counts as pending, never passing. GitHub's `mergeable` is null until it has worked it out, which the first read starts. The App's owner is kept by login only: its kind comes from an installation on that account, else an owner other than the signed-in user is taken as an organization.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

GitHubAccess, GitHubIdentities, IdentityAuthorization, IdentityReturn, GitHubPullRequests, OpenedPullRequestOnGitHub, OpenPullRequestOnGitHub, PullRequestOnRemote, PullRequestStatusOnGitHub, GitHubChecks, GitHubMergeable, GitHubPullRequestState, GITHUB_URLS, GitHubUrls, GitHubAppRegistered, GitHubIdentityFailed, GitHubIdentity, GitHubAccessFailed, NotSignedInWithGitHub, GitHubRepository, GitHubModule, PullRequestNotOpened

## Domain events

- `domain/github-events.ts`: GitHubAppRegistered, GitHubSignedIn, GitHubPermissionsChecked, GitHubSignedOut

## HTTP routes (under `/api`)

- `GET /github/app/manifest`: GitHubAppController.manifest
- `GET /github/app/registered`: GitHubAppController.registered
- `GET /github`: GitHubController.state
- `POST /github/permissions/check`: GitHubController.checkPermissions
- `POST /github/sign-in`: GitHubController.startSignIn
- `GET /github/sign-in/callback`: GitHubController.signedIn
- `GET /github/repositories`: GitHubController.repositories
- `DELETE /github/sign-in`: GitHubController.signOut

## Tables

- `adapters/postgres/github.schema.ts`: github_app, github_sign_in

## Files

### ./

- `github.module.ts`: GitHubModule
- `index.fixtures.ts`: FAKE_GITHUB_SECRETS, FAKE_PERMISSIONS_CONTROL_PATH, FAKE_PULL_REQUESTS_CONTROL_PATH, FAKE_TOKEN_PREFIXES, FakeGitHub, FakeGitHubApp, RecordedRequest, FAKE_DEFAULT_PERMISSIONS, FakeAccountType, FakePermissionLevel, FakeRepository, FakeCheckRun, FakeChecks, FakeCommitStatus, FakePullRequest, PullRequestControl, registeredGitHubAppForTests, signedInWithGitHubForTests

### adapters/github/

- `fake-github-installations.fixtures.ts`: FakeRepository, FakePermissionLevel, FakeAccountType, FAKE_DEFAULT_PERMISSIONS, ApiAnswer, FakeInstallations
- `fake-github-pulls.fixtures.ts`: FakePullRequest, FakeCheckRun, FakeCommitStatus, FakeChecks, pullRequestControlSchema, PullRequestControl, FakePullRequests
- `fake-github.fixtures.ts`: FAKE_GITHUB_SECRETS, FAKE_TOKEN_PREFIXES, FakeGitHubApp, RecordedRequest, FAKE_INSTALLATIONS_CONTROL_PATH, FAKE_PULL_REQUESTS_CONTROL_PATH, FAKE_PERMISSIONS_CONTROL_PATH, FakeGitHub
- `github-rest-api.ts`: GitHubRestApi
- `serve-fake-github.fixtures.ts`

### adapters/http/

- `github-app.controller.ts`: GitHubAppController
- `github-return-urls.ts`: RETURN_PATHS, officeOriginOf, returnUrlsOf
- `github.controller.ts`: GitHubController
- Tests: github-app.controller.full.test.ts, github-app.controller.test.ts, github.controller.full.test.ts, github.controller.test.ts

### adapters/postgres/

- `github.schema.ts`: githubApp, githubSignIn
- `postgres-github-app.ts`: PostgresGitHubApp
- `postgres-github-sign-in.ts`: PostgresGitHubSignIn
- Tests: postgres-github-app.test.ts, postgres-github-sign-in.test.ts

### adapters/websocket/

- `github-web-events.ts`: GitHubWebEvents

### application/

- `app-registration.ts`: ManifestForm, AppRegistration
- `github-access.ts`: GitHubAccess, failedAccess
- `github-identities.ts`: IdentityAuthorization, IdentityReturn, GitHubIdentities
- `github-permissions.ts`: LackedPermissions, GitHubPermissions
- `github-pull-requests.ts`: PullRequestOnRemote, OpenedPullRequestOnGitHub, OpenPullRequestOnGitHub, PullRequestStatusOnGitHub, GitHubPullRequests
- `github-sign-in.ts`: SignInState, SignInReturn, GitHubSignIn, refusalReason
- `github-urls.ts`: GitHubUrls, GITHUB_URLS, appInstallUrl, gitHubUrl
- `pending-states.ts`: PendingStates
- `sign-in-changes.ts`: SignInChanges
- Tests: github-access.full.test.ts, github-access.test.ts, github-identities.test.ts, github-permissions.test.ts, github-pull-requests.full.test.ts, github-pull-requests.test.ts

### domain/

- `github-app.ts`: GitHubApp, GitHubAppManifest, PermissionLevel, REQUIRED_PERMISSIONS, MissingPermission, missingPermissions, ManifestReturnUrls, gitHubAppManifest, GitHubAppRegistrationFailed
- `github-events.ts`: GitHubAppRegistered, GitHubSignedIn, GitHubPermissionsChecked, GitHubSignedOut
- `github-identity.ts`: GitHubIdentity, GitHubIdentityFailed
- `github-repository.ts`: GitHubRepository, GitHubAccessFailed, NotSignedInWithGitHub
- `pull-request-status.ts`: GitHubPullRequestState, GitHubChecks, GitHubMergeable, CheckRunOnGitHub, CommitStatusOnGitHub, ChecksOnGitHub, checksOf, mergeableOf, pullRequestStateOf
- `pull-request.ts`: RepositoryOnGitHub, PullRequestToOpen, PullRequestNotOpened, repositoryOnGitHubOf, fullNameOf, pullRequestRefusal
- `sign-in.ts`: UserTokens, needsRefresh, usableRefreshToken, SignedOutReason, KeptSignIn, GitHubSignInFailed
- Tests: pull-request-status.full.test.ts, pull-request-status.test.ts, pull-request.full.test.ts

### ports/

- `github-api.ts`: SignInCode, GitHubUser, TokenAnswer, GitHubApi, PullRequestOnGitHub, ListedPullRequest, PullRequestDetail, GitHubInstallation, PullRequestAnswer, GitHubApiFailure, GitHubUnreachable
- `github-app-repository.fixtures.ts`: GitHubAppForTests, registeredGitHubAppForTests
- `github-app-repository.ts`: GitHubAppRepository
- `github-sign-in-repository.fixtures.ts`: GitHubSignInForTests, signedInWithGitHubForTests
- `github-sign-in-repository.ts`: GitHubSignInRepository

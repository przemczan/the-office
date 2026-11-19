# Users: module map

**Owns:** users and signing in (spec §2.10): `users` (name, email kept as typed and unique ignoring case among users not removed, a scrypt password hash `scrypt$N$r$p$salt$key` from `ScryptPasswordHashing`, `one_time_password_expires_at` set while that hash is a one-time password's, the wrong tries: how many in a row, the next try allowed at, locked until; `palette` and `density`, null for Follow the system and Comfortable; `removed_at`) and `signed_in_devices` (one row per browser signed in: the SHA-256 of its token only, its user agent and address kind, signed in, last seen and expires, 30 days after the last use, both written at most once a minute). The first user (`FirstUser`, `POST /sign-in/first-user`) is made only while no user was ever made, removed ones counted, in one transaction, so two at once make one. `Users` (Settings › Users, `/users`) lists the users not removed, adds one with a one-time password (`domain/one-time-password.ts`: 16 characters without look-alikes, shown grouped by four, hashed as typed without dashes in capitals, answered once and kept nowhere; it works 7 days, and a waiting user's can be made anew, which ends the old), and removes one: `removeAmongActive` locks every user not removed in id order and refuses yourself and a remover removed meanwhile, so two users removing each other leave one; the row stays, its password hash cleared, so `namesOf` still reads the name, its email free again; then `SignedInDevices.signOutAll`. `PasswordChecks` checks any password, a one-time one included: it counts a try wrong before checking and clears the count once it matches; `domain/wrong-tries.ts` holds the Defaults (3 free tries, then waits of 2, 4, 8 and 16 s answered as 429 with when to try again, never slept on; the 10th in a row locks for 15 minutes, doubling up to a day). An unknown or removed user's email gets the same answers, hashed against a dummy (`UnknownEmailTries`, in memory). `PasswordSignIn` signs in with it; a right one-time password answers `set-password` and makes no device (`expired` past its days), and `FirstPassword` (`POST /sign-in/set-password`) takes it again with the user's own, under the same checks, and ends in `SignIns.finish`. `Accounts` answers `/account`: the profile, a password change (the current one under the same checks, answered "The current password is wrong."; it signs out every other device) and the appearance. `SignedInDevices` lists, checks and signs out devices; a removed user's devices sign in nothing (`findByTokenHash` joins the user). `Passwords` sets a password (the host's `npm run set-password`, `src/set-password.ts`), lifting the lockout and the one-time password and signing out every device. The cookie (`adapters/http/sign-in-cookie.ts`, `office_signed_in`) is `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` only when the request came through the public address over https. **Passkeys** (`passkeys`: credential id base64url and unique, public key as bytea, counter, transports, name, rp id, device type, backed up, created and last used; rows go on `UserRemoved` and cascade with the row): the relying party is the page's own address (`domain/relying-party.ts`'s `relyingPartyAt`, from the `PageAddress` the HTTP adapter builds with `pageAddressOf`: `localhost` with the checked Host's origin, or the public address's hostname and origin over HTTPS, never the request's Origin; a loopback IP answers `ip-address` with a link to `localhost` at its port, a local network IP, plain HTTP at the public address or a public address that is an IP `needs-https-domain`), and `passkeyAt` tells each passkey's rp id against it (this, the other or an old address). `Passkeys` (`/account/passkeys`) lists, starts adding after the current password (`PasswordChecks.currentUserOf`, shared with the password change), finishes adding, renames (1–60 characters) and removes the user's own (another's is `PasskeyNotFound`, 404); `PasskeySignIn` (`/sign-in/passkey`) starts a discoverable ceremony under a random key its `office_passkey_ceremony` cookie carries (`HttpOnly`, `SameSite=Strict`, `Path=/api/sign-in/passkey`, 5 minutes), then takes it, finds the passkey by credential id, checks its rp id is this address's and the user handle (`userHandleOf`, the user's id as bytes) its user's, verifies, refuses a counter that didn't go up when either isn't 0 (`isPossibleClone`, logged as a possible copy), saves counter and last use and ends in `SignIns.finish(user, PASSKEY_WAY)`; every failure is `SignInRefused.passkey()`, and the password's lockout doesn't stop it. The ceremonies (`PasskeyCeremonies`, bound to `adapters/webauthn/`'s `SimpleWebAuthnPasskeyCeremonies` over `@simplewebauthn/server` 14: no attestation, discoverable, user verification required) and the pending ones (`PendingCeremonies`, in memory, `adapters/in-memory/`, at most 1000, expired then oldest dropped, each taken once, 5 minutes by the `Schedule`; adding keyed by the signed-in device, so another device can't finish it).

**First-run setup** (`first_run_setup`, one row once a setup token is made: the token's SHA-256 only, when it was made, when the basics opened and closed; no row means an Office whose users came first, its basics closed): `FirstRunSetup` makes the **setup token** (`domain/setup-token.ts`: 24 characters of the one-time password's alphabet, grouped by four, hashed as typed without dashes in capitals, compared with `timingSafeEqual`), `newToken()` for the host's `npm run setup-token` (`src/setup-token.ts`, refused with `FirstUserExists` once a user exists) and `tokenAtStart()` for `office.ts`'s start (`made`, `waiting` or `not-needed`; `saveTokenIfNoneWaiting` keeps one of two at once), the token answered only to be printed. `FirstUser.create` checks it first (`SetupTokenRefused`, 403, saying to run `npm run setup-token`), then the fields; `UserRepository.addFirst(user, setupAfterwards)` writes the user and First-run setup after it (token used up, basics open, or closed at once with `OFFICE_SKIP_SETUP_BASICS`, `UsersModule.register({ skipSetupBasics })`) in one transaction. `GET /first-run-setup` answers whether the basics are open, `POST /first-run-setup/close` closes them for good (`SetupTokenMade`, `FirstRunBasicsClosed`, neither carrying the token or its hash).

**The authenticator** (spec §2.10 Defaults): `authenticators` (one per user: the TOTP secret in base32, readable since codes are checked against it, confirmed at, the last time step whose code was taken) and `recovery_codes` (SHA-256 of the normalised code only, used at), kept together by `AuthenticatorRepository`. `Authenticators` sets one up (`POST /account/authenticator`: a new secret in place of any unconfirmed one, its `otpauth://` address and key sent only then), turns it on with a first code (`/confirm`, answering 10 recovery codes once, `XXXXX-XXXXX` from `domain/recovery-code.ts`'s alphabet without look-alikes), turns it off (`DELETE`, with a code or a recovery code) and makes new recovery codes (`POST /account/recovery-codes`, with a code); `npm run set-password -- --clear-authenticator` removes it with its recovery codes through `Authenticators.remove`, the new password having lifted the lockout; `GET /account` says `off` or `on` with the recovery codes left. `domain/authenticator.ts` checks a code at the `Schedule`'s time, one step either side, never a step at or before the last taken (`takeStep` is a conditional UPDATE, so two requests can't both take one). `AuthenticatorCodes` checks a code or a recovery code for every use, counted by `UserWrongTries` on the user's one count of wrong tries (spec: "the user's password and codes are locked"), cleared by a right code; `PasswordChecks` counts passwords (signing in, the first password, Change password) on the same count, and a right password undoes only its own try (`UserWrongTries.undo`), so it never resets wrong codes before it.

**The code step:** `SecondSteps` is bound to `AuthenticatorSecondStep`: after a way not `enoughAlone` (a `SignInWay` flag; only the passkey's is true), a user whose authenticator is on gets a pending sign-in (`pending_sign_ins`: the SHA-256 of its token, 5 minutes) instead of a signed-in device, and the outcome `code-needed`; a right one-time password answers `set-password` before any of this, and the first password then ends in `SignIns.finish` too. `adapters/http/sign-in-answers.ts` writes every way's answer: `answerSignIn` in the body, `redirectSignIn` for a callback (to `/sign-in/code?returnTo=…` when the code is needed); the pending token travels only in `office_pending_sign_in` (`HttpOnly`, `SameSite=Lax`, `Path=/api/sign-in`, `Max-Age=300`). `POST /sign-in/code` (`CodeSignIn`) checks the code, uses the pending sign-in up and signs the device in through `SignIns.signIn`, which clears the wrong tries; an ended pending sign-in answers 401.

**Linked identities** (`linked_identities`: provider, `subject` (the provider's own id for the person, GitHub's numeric user id as text, Google's or the OpenID Connect provider's ID token `sub`), `name` (the GitHub login, the Google email, or the OpenID Connect email, else preferred username, else `sub`, display only, updated at each sign-in and each link again), linked at, last signed in at; unique on (provider, subject) and (user, provider); rows go on `UserRemoved` and cascade with the row): `LinkedIdentities` (`/account/linked-identities`) lists each bound provider (its `providerName`, the display name, the saved name for OpenID Connect) with whether it is set up, why it doesn't work at the page's address (`unavailableHere`) and the user's identity there, starts linking (a trip tied to the user and signed-in device, returning to `/account/linked-identities`), links (again as the same user only takes the new name; one linked to another user is refused without saying whose, a second of the same provider is refused, a race on either unique index is caught by `onConflictDoNothing`) and unlinks (`IdentityLinked`, `IdentityUnlinked`; `LinkedIdentityRepository.removeAllAt(provider)` removes every link at a provider, which saving an OpenID Connect provider with another issuer uses). **Continue with GitHub, Continue with Google and Continue with <name>** (`IdentitySignIns`, `/sign-in/github`, `/sign-in/google`, `/sign-in/openid-connect`): a start (sign-in or link) goes through `IdentityProviders.startingAt`, refusing a provider not set up or one whose `unavailableAt(page)` says it doesn't work at the page's address (`IdentityRefused.notHere`, 409, with where it works); the sign-in's start answers the provider's authorize URL and sets the trip cookie (`office_identity_trip`, the nonce whose SHA-256 the trip keeps: `HttpOnly`, `SameSite=Lax`, `Path=/api/sign-in`, 10 minutes, `Secure` over HTTPS); `GET /sign-in/<provider>/callback` is each provider's one callback for signing in and linking (one URL per address to list on GitHub): it takes the trip by its state (`IdentityTrips`, in memory, at most 1000, 10 minutes, each taken once), checks a sign-in's trip cookie or a link's signed-in device (read here through `CookieSignedInRequests`, as the guard skips `/sign-in`), asks the provider who it is, then links, or finds the user only by (provider, subject), never by email or login (a removed user is refused as not linked) and ends in `SignIns.finish` with the provider's way (never enough alone, so the code step applies); it always redirects: signed in through `redirectSignIn` to `returnTo` (a path of The Office's own only, `ownPathOr`, else `/`), or first to the code page, linked to the account, refused to `/sign-in?signInFailed=` or `/account/linked-identities?linkFailed=` with why (an unknown trip goes to the account when the browser is signed in). The redirect URI is the page's address (`identity-callback-urls.ts`): the request's protocol and checked Host, or the configured public address there; `GET /account/identity-callback-urls/<provider>` answers this address's (null where the provider doesn't work, Google at an IP address; OpenID Connect works everywhere) and the public address's, for Settings › Office identity and Settings › Signing in.

**The Google OAuth client** (`google_client`, one row: client id, client secret as entered, since it is sent to Google, saved at): `GoogleClients` (Settings › Signing in, `/settings/google-client`) answers only the client id and `secretSet`, never the secret; saving with an empty secret keeps the saved one (`domain/google-client.ts`'s `googleClientOf`, trimming both, every problem a `UserRefused`, 422); removing it keeps the linked Google identities, as `sub` doesn't depend on the client (`GoogleClientSaved`, `GoogleClientRemoved`, never the secret). **`GoogleIdentityProvider`** (`adapters/google/`, the only user of `arctic`): available while a client is saved; works where `secureNameMissingAt(page)` says so, the passkeys' rule (`localhost`, or the public address's name over HTTPS); builds arctic's `Google` per trip, since arctic fixes the redirect URI in its constructor; asks `openid email` with PKCE S256 and no `access_type=offline`; checks the ID token's `iss` (`https://accounts.google.com` or `accounts.google.com`), `aud` (the client id) and `exp` on the `Schedule`, not its signature (it comes straight from Google's token endpoint over TLS); answers `sub` and the email; throws the access token away unrevoked (revoking would make Google ask for consent at every sign-in); maps Google's errors to readable reasons (`redirect_uri_mismatch` names the URI to add) and logs only the OAuth error code.

**The OpenID Connect provider** (`openid_connect_provider`, one row: name, issuer, client id, client secret as entered, authorization endpoint, token endpoint, saved at, removed at; removing sets `removed_at` and clears the secret but keeps the issuer, which `lastIssuer()` answers): `OpenIdConnectProviders` (Settings › Signing in, `GET/PUT/DELETE /settings/openid-connect-provider`) answers the name, issuer and client id and `secretSet`, never the secret; saving with an empty secret keeps the saved one (`domain/openid-connect-provider.ts`, every problem a `UserRefused`, 422: name 1 to 40 characters, issuer and endpoints HTTPS or loopback `http`); it reads the issuer's `.well-known/openid-configuration` through the `OpenIdConnectDiscovery` port (`adapters/openid-connect/fetch-openid-connect-discovery.ts`, Node `fetch`, 10 s timeout; `FakeOpenIdConnectDiscovery` in the fixtures), checks its `issuer` equals the entered one (trailing slash ignored) and keeps the two endpoints, again at every save; a save with another issuer than the one saved last, removed since or not, removes the old issuer's links (`removeAllAt`), so a `sub` at the new issuer never signs in an old link; removing the provider keeps them (`OpenIdConnectProviderSaved` carries `identitiesUnlinked`, `OpenIdConnectProviderRemoved`, never the secret). **`OpenIdConnectIdentityProvider`** (`adapters/openid-connect/`, `arctic`'s `OAuth2Client`): available while a provider is saved and at every address; its `displayName()` is the saved name (the `IdentityProvider` port's default is the static provider name, and `IdentityRefused`'s factories take it); authorization code with PKCE S256, `openid email profile`, the secret sent by HTTP Basic (`client_secret_basic`); checks the ID token's `iss` (the saved issuer), `aud` and `exp` on the `Schedule`, not its signature (it comes straight from the token endpoint over TLS); answers `sub` and the email, else `preferred_username`, else `sub`; throws the access token away, asks for no refresh token.

**Extension points:** `SignIns.finish(user, way, request)` is where every way of signing in ends, given the `SignInWay` itself: unless the way is `enoughAlone` (only a passkey is), it asks the `SecondSteps` port, then makes the signed-in device; a later way answers its callback with `redirectSignIn`. `SignInWays` is the registry of ways (`SignInWay`: its kind, `enoughAlone`, `unavailableAt(page)` with a reason and where it works instead, whether it is set up); `password` and `passkey` are built in, a later way's module `add`s itself, and `GET /sign-in` lists those that work at the page's address and, as `unavailable`, those set up that don't, with `reason` and `elsewhere`, which Continue with Google and Continue with <name> reuse. **`IdentityProvider`** (`ports/identity-provider.ts`: `provider`, `isAvailable`, `unavailableAt(page)`, `authorizeUrl`, `identityOf`, failures as `IdentityProviderFailed`) is the extension point for identity providers: `UsersModule.register({ imports, identityProviders })` binds each adapter (`GitHubIdentityProvider` in `adapters/github/`, over the github module's `GitHubIdentities`; `GoogleIdentityProvider` in `adapters/google/`; `OpenIdConnectIdentityProvider` in `adapters/openid-connect/`), `IdentityProviders` lists them, and `IdentitySignIns` adds each as a way (never enough alone). A provider adds its id to `IdentityProviderId` and the contracts' `identityProviderSchema`, an adapter, and its own explicit `/sign-in/<provider>`, callback and `/account/linked-identities/<provider>` routes (no `:provider` route, which would shadow `/sign-in/password`), reusing `IdentityTrips`, the trip cookie, the device check and the linked identities, with no branch of its own in `IdentitySignIns` or `LinkedIdentities`. Contracts' `SignInWay` and the sign-in answer's `outcome` are discriminated unions (`password`, `passkey`, `github`, `google` and `openid-connect`, the last carrying its `name`, as `SignInWays.at` answers `OfferedWay {kind, name}`; `signed-in`, `code-needed` and `set-password`), as is the web's way-kind map (`surfaces/sign-in/sign-in-ways.tsx`). Every later way's callback lives under `/api/sign-in/`, the only path open without a signed-in device.

**Talks to:** the platform's `SignedInRequests` port, bound in `app.module.ts` to `CookieSignedInRequests` through `RequestAccessModule`, which the platform's guard and event stream ask who a request's device is, and whose `onSignedOut` (the `SignedOut` event) closes that device's WebSockets at once, and `signedOutAmong` each minute those of devices signed out by the recovery command's own process or expired; the platform's `OfficeAddresses` for the address kind (`adapters/http/sign-in-request.ts` maps it to the domain's own copy); the `Schedule` for the time; the github module's `GitHubIdentities` (through `GitHubIdentityProvider`), which never touches Sign in with GitHub; Google's authorize page and token endpoint, through `arctic` in `GoogleIdentityProvider`; the OpenID Connect provider's discovery document, authorize page and token endpoint, through `fetch` and `arctic` in `adapters/openid-connect/`. Publishes `UserCreated`, `UserChanged`, `UserRemoved`, `SignedIn`, `SignedOut`, `PasswordSet`, `AuthenticatorSetUp`, `AuthenticatorRemoved`, `RecoveryCodesMade`, `RecoveryCodeUsed`, `PasskeyAdded`, `PasskeyRenamed`, `PasskeyRemoved`, `IdentityLinked`, `IdentityUnlinked`, `GoogleClientSaved`, `GoogleClientRemoved`, `OpenIdConnectProviderSaved`, `OpenIdConnectProviderRemoved`, none carrying a secret, token or code; `adapters/websocket/user-web-events.ts` forwards the first three to the web. A later Task's own tables of a user's clean up on `UserRemoved`, as `passkeys` and `linked_identities` do, since the user's row stays and nothing cascades; `Users.remove` itself ends the user's pending sign-ins and removes their authenticator and recovery codes.

**Traps:** a signed-in device is never called a session, in code, API or database. `UserRepository.find` answers removed users too (for the records); everything that signs in or lists goes through `findByEmail`, `listActive` or a check of `removedAt`. The host commands (`set-password.ts`, `setup-token.ts`) boot the module through `src/host-command.module.ts`, without the event stream, so it provides its own `WebEventForwarding` and the global `EarlierRecordsModule`. A test that makes the first user gets a token with `newSetupToken(office)` from `index.fixtures.ts`, on a `freshTestDatabase`: the shared one has users, so no token is made there. The domain keeps its own `AddressKind`, since the boundary lint allows it nothing from the platform but `DomainEvent`. Unknown emails' wrong tries are in memory and start again at a restart; a user's are in the database and don't. Other modules' tests boot unguarded (`startTestApplication` binds `EveryoneSignedIn`); a test that needs the guard uses `startUsersApplication` and `signedInCookie` from `index.fixtures.ts`, and `turnOnAuthenticator` and `authenticatorCodeOf` for a user with an authenticator; a code of the confirming step is taken already, so the next sign-in uses the next step's code (`ManualSchedule.advanceBy` 30 s, or one step of drift). The fixtures' `send` gives a body's Content-Length, without which Node sends no DELETE body. A pending sign-in is never called a session. Passkey tests use `passkeys.fixtures.ts` (pages at `localhost`, `127.0.0.1` and the public address, `addPasskey`) and `adapters/webauthn/software-authenticator.fixtures.ts`, a P-256 key that answers as a browser would, with tampering for origin, rp id, user verification and user handle. The library's own counter check is given 0, since the counter's rule is the domain's; pending ceremonies are lost at a restart, which only means starting again. `UsersModule` is registered once in `app.module.ts` and that one instance is given to `RequestAccessModule` too; `set-password.ts` and `startUsersApplication` register it with no identity provider unless a test binds `FakeIdentityProvider` (`adapters/fake/`, bound as `github`) or `FakeGoogleIdentityProvider` (bound as `google`, unavailable at an IP address); `linked-identities.fixtures.ts`'s `startWithFakeProvider`, `startWithFakeGoogle`, `linkAt` and `continueAt` follow the bound one. `google_client` is one row of the database every test file shares: only `postgres-google-client-repository.test.ts` writes it, and other tests bind `googleClientForTests()` (`ports/google-client-repository.fixtures.ts`). So is `openid_connect_provider`: only `postgres-openid-connect-provider-repository.test.ts` writes it, other tests bind `openIdConnectProviderForTests()` and `openIdConnectDiscoveryForTests()` (`startWithFakeOpenIdConnect`, `FakeOpenIdConnectIdentityProvider` bound as `openid-connect`), and `openid-connect-provider.controller.test.ts` uses an in-memory `LinkedIdentityRepository`, since `removeAllAt` would wipe other files' links in the shared `linked_identities`. The `linked_identities` table is shared by every test of a run, so a test's provider identity takes a random subject. A redirect URI mismatch is sent by GitHub to the App's first callback URL, Sign in with GitHub's, so its page words it (the github module's map).

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

GitHubIdentityProvider, GoogleIdentityProvider, OpenIdConnectIdentityProvider, CookieSignedInRequests, answerSignIn, redirectSignIn, Accounts, Authenticators, FirstRunSetup, Passwords, SignInWays, SignIns, SignInOutcome, SignedInOutcome, SignedInDevices, Users, AddressKind, SignInRequest, SignInWay, SignInWayKind, AuthenticatorRemoved, AuthenticatorSetUp, IdentityLinked, IdentityUnlinked, PasswordSet, RecoveryCodeUsed, RecoveryCodesMade, SignedIn, SignedOut, UserChanged, UserCreated, UserRemoved, FirstUserExists, UserNotFound, UserRefused, UsersModule, UsersModuleOptions

## Domain events

- `domain/user-events.ts`: UserCreated, UserChanged, UserRemoved, SignedIn, SignedOut, PasswordSet, AuthenticatorSetUp, AuthenticatorRemoved, RecoveryCodesMade, RecoveryCodeUsed, PasskeyAdded, PasskeyRenamed, PasskeyRemoved, IdentityLinked, IdentityUnlinked, GoogleClientSaved, GoogleClientRemoved, OpenIdConnectProviderSaved, OpenIdConnectProviderRemoved, SetupTokenMade, FirstRunBasicsClosed

## HTTP routes (under `/api`)

- `POST /sign-out`: AccountController.signOut
- `GET /account`: AccountController.account
- `POST /account/authenticator`: AccountController.setUpAuthenticator
- `POST /account/authenticator/confirm`: AccountController.confirmAuthenticator
- `DELETE /account/authenticator`: AccountController.turnOffAuthenticator
- `POST /account/recovery-codes`: AccountController.newRecoveryCodes
- `PATCH /account`: AccountController.changeProfile
- `POST /account/password`: AccountController.changePassword
- `PUT /account/appearance`: AccountController.setAppearance
- `GET /account/signed-in-devices`: AccountController.signedInDeviceList
- `DELETE /account/signed-in-devices/:id`: AccountController.signOutDevice
- `GET /first-run-setup`: FirstRunSetupController.state
- `POST /first-run-setup/close`: FirstRunSetupController.close
- `GET /settings/google-client`: GoogleClientController.setting
- `PUT /settings/google-client`: GoogleClientController.save
- `DELETE /settings/google-client`: GoogleClientController.remove
- `POST /sign-in/github`: IdentitySignInController.startGitHub
- `GET /sign-in/github/callback`: IdentitySignInController.gitHubReturned
- `POST /sign-in/google`: IdentitySignInController.startGoogle
- `GET /sign-in/google/callback`: IdentitySignInController.googleReturned
- `POST /sign-in/openid-connect`: IdentitySignInController.startOpenIdConnect
- `GET /sign-in/openid-connect/callback`: IdentitySignInController.openIdConnectReturned
- `GET /account/linked-identities`: LinkedIdentitiesController.list
- `POST /account/linked-identities/github`: LinkedIdentitiesController.linkGitHub
- `DELETE /account/linked-identities/github`: LinkedIdentitiesController.unlinkGitHub
- `GET /account/identity-callback-urls/github`: LinkedIdentitiesController.gitHubCallbackUrls
- `POST /account/linked-identities/google`: LinkedIdentitiesController.linkGoogle
- `DELETE /account/linked-identities/google`: LinkedIdentitiesController.unlinkGoogle
- `GET /account/identity-callback-urls/google`: LinkedIdentitiesController.googleCallbackUrls
- `POST /account/linked-identities/openid-connect`: LinkedIdentitiesController.linkOpenIdConnect
- `DELETE /account/linked-identities/openid-connect`: LinkedIdentitiesController.unlinkOpenIdConnect
- `GET /account/identity-callback-urls/openid-connect`: LinkedIdentitiesController.openIdConnectCallbackUrls
- `GET /settings/openid-connect-provider`: OpenIdConnectProviderController.setting
- `PUT /settings/openid-connect-provider`: OpenIdConnectProviderController.save
- `DELETE /settings/openid-connect-provider`: OpenIdConnectProviderController.remove
- `POST /sign-in/passkey/options`: PasskeySignInController.options
- `POST /sign-in/passkey`: PasskeySignInController.signIn
- `GET /account/passkeys`: PasskeysController.list
- `POST /account/passkeys/options`: PasskeysController.options
- `POST /account/passkeys`: PasskeysController.add
- `PATCH /account/passkeys/:id`: PasskeysController.rename
- `DELETE /account/passkeys/:id`: PasskeysController.remove
- `GET /sign-in`: SignInController.page
- `POST /sign-in/first-user`: SignInController.createFirstUser
- `POST /sign-in/password`: SignInController.withPassword
- `POST /sign-in/code`: SignInController.withCode
- `POST /sign-in/set-password`: SignInController.setPassword
- `GET /users`: UsersController.list
- `POST /users`: UsersController.add
- `POST /users/:userId/one-time-password`: UsersController.newOneTimePassword
- `DELETE /users/:userId`: UsersController.remove

## Tables

- `adapters/postgres/first-run-setup.schema.ts`: first_run_setup
- `adapters/postgres/google-client.schema.ts`: google_client
- `adapters/postgres/linked-identities.schema.ts`: linked_identities
- `adapters/postgres/openid-connect-provider.schema.ts`: openid_connect_provider
- `adapters/postgres/passkeys.schema.ts`: passkeys
- `adapters/postgres/users.schema.ts`: users, signed_in_devices, earlier_records_claimed, authenticators, recovery_codes, pending_sign_ins

## Files

### ./

- `index.fixtures.ts`: A_PASSWORD, UserForTests, addUser, signedInCookie, authenticatorCodeOf, turnOnAuthenticator, newSetupToken, send, setCookieOf, startUsersApplication, UsersApplication
- `linked-identities.fixtures.ts`: OfficeWithProvider, OfficeWithOpenIdConnect, startWithFakeProvider, startWithFakeGoogle, startWithFakeOpenIdConnect, cookieNamed, stateOf, backFromProvider, startLinking, linkAt, startSignIn, continueAt, locationOf
- `passkeys.fixtures.ts`: PageAt, atLocalhost, atLoopbackIp, atPublicAddress, sendFrom, signedInAt, addingOptions, addPasskey, SoftwareAuthenticator
- `users-application.fixtures.ts`: PUBLIC_ADDRESS, testPasswordHashing, UsersApplication, UsersApplicationOptions, startUsersApplication, newSetupToken, Sent, Answer, send, setCookieOf
- `users.module.ts`: UsersModuleOptions, UsersModule

### adapters/crypto/

- `scrypt-password-hashing.ts`: ScryptPasswordHashing
- Tests: scrypt-password-hashing.test.ts

### adapters/fake/

- `fake-identity-provider.fixtures.ts`: FAKE_AUTHORIZE_URL, FakeIdentityProvider, FakeGoogleIdentityProvider, FakeOpenIdConnectIdentityProvider

### adapters/github/

- `github-identity-provider.ts`: GitHubIdentityProvider
- Tests: github-identity-provider.test.ts

### adapters/google/

- `google-identity-provider.ts`: GoogleIdentityProvider
- Tests: google-identity-provider.test.ts

### adapters/http/

- `account.controller.ts`: AccountController
- `cookie-signed-in-requests.ts`: CookieSignedInRequests
- `first-run-setup.controller.ts`: FirstRunSetupController
- `google-client.controller.ts`: GoogleClientController
- `identity-callback-urls.ts`: pageOriginOf, identityCallbackUrlOf, identityCallbackUrlsOf
- `identity-sign-in.controller.ts`: IdentitySignInController
- `identity-trip-cookie.ts`: IDENTITY_TRIP_COOKIE, identityTripCookie, clearedIdentityTripCookie
- `linked-identities.controller.ts`: LinkedIdentitiesController
- `openid-connect-provider.controller.ts`: OpenIdConnectProviderController
- `passkey-ceremony-cookie.ts`: PASSKEY_CEREMONY_COOKIE, passkeyCeremonyCookie, clearedPasskeyCeremonyCookie
- `passkey-messages.ts`: ceremonyAnswerOf, passkeyMessageOf
- `passkey-sign-in.controller.ts`: PasskeySignInController
- `passkeys.controller.ts`: PasskeysController
- `sign-in-answers.ts`: answerSignIn, redirectSignIn
- `sign-in-cookie.ts`: SIGN_IN_COOKIE, PENDING_SIGN_IN_COOKIE, signInCookie, clearedSignInCookie, pendingSignInCookie, clearedPendingSignInCookie, signInTokenOf, pendingSignInTokenOf, cookieValueOf
- `sign-in-request.ts`: addressKindOf, pageAddressOf, signInRequestOf
- `sign-in.controller.ts`: SignInController
- `user-refusals.filter.ts`: UserRefusalsFilter
- `users.controller.ts`: UsersController
- Tests: account.controller.test.ts, authenticator.test.ts, first-run-setup.controller.test.ts, google-client.controller.test.ts, google-sign-in.test.ts, identity-sign-in.controller.test.ts, linked-identities.controller.test.ts, openid-connect-provider.controller.test.ts, openid-connect-sign-in.test.ts, passkey-sign-in.controller.test.ts, passkeys.controller.test.ts, sign-in-answers.test.ts, sign-in.controller.test.ts, users.controller.test.ts

### adapters/in-memory/

- `in-memory-pending-ceremonies.ts`: PENDING_CEREMONIES_CAP, InMemoryPendingCeremonies
- Tests: in-memory-pending-ceremonies.test.ts

### adapters/openid-connect/

- `fetch-openid-connect-discovery.ts`: DISCOVERY_TIMEOUT_MS, FetchOpenIdConnectDiscovery
- `openid-connect-identity-provider.ts`: OpenIdConnectIdentityProvider
- Tests: fetch-openid-connect-discovery.test.ts, openid-connect-identity-provider.test.ts

### adapters/postgres/

- `first-run-setup.schema.ts`: firstRunSetup
- `google-client.schema.ts`: googleClient
- `linked-identities.schema.ts`: linkedIdentities
- `openid-connect-provider.schema.ts`: openIdConnectProvider
- `passkeys.schema.ts`: passkeys
- `postgres-authenticator-repository.ts`: PostgresAuthenticatorRepository
- `postgres-first-run-setup-repository.ts`: firstRunSetupRowOf, PostgresFirstRunSetupRepository
- `postgres-google-client-repository.ts`: PostgresGoogleClientRepository
- `postgres-linked-identity-repository.ts`: PostgresLinkedIdentityRepository
- `postgres-openid-connect-provider-repository.ts`: PostgresOpenIdConnectProviderRepository
- `postgres-passkey-repository.ts`: PostgresPasskeyRepository
- `postgres-pending-sign-in-repository.ts`: PostgresPendingSignInRepository
- `postgres-signed-in-device-repository.ts`: PostgresSignedInDeviceRepository
- `postgres-user-repository.ts`: PostgresUserRepository
- `users.schema.ts`: users, signedInDevices, earlierRecordsClaimed, authenticators, recoveryCodes, pendingSignIns
- Tests: postgres-google-client-repository.test.ts, postgres-openid-connect-provider-repository.test.ts, postgres-passkey-repository.test.ts

### adapters/second-steps/

- `authenticator-second-step.ts`: AuthenticatorSecondStep

### adapters/webauthn/

- `simple-webauthn-passkey-ceremonies.ts`: SimpleWebAuthnPasskeyCeremonies
- `software-authenticator.fixtures.ts`: Tampering, SoftwareAuthenticator

### adapters/websocket/

- `user-web-events.ts`: UserWebEvents

### application/

- `accounts.ts`: PasswordChange, Accounts
- `authenticator-codes.ts`: CodeAnswer, AuthenticatorCodes
- `authenticators.ts`: AuthenticatorState, AuthenticatorSetup, Authenticators
- `code-sign-in.ts`: CodeSignIn
- `earlier-records-claims.ts`: EarlierRecordsClaims
- `first-password.ts`: FirstPasswordRequest, FirstPassword
- `first-run-setup.ts`: TokenAtStart, FirstRunSetupOptions, FirstRunSetup
- `first-user.ts`: FirstUser
- `google-clients.ts`: GoogleClientShown, GoogleClients
- `identity-providers.ts`: IdentityProviders
- `identity-sign-ins.ts`: IdentitySignInStart, ProviderReturn, ReturningBrowser, IdentityReturnOutcome, IdentitySignIns
- `identity-trips.ts`: IDENTITY_TRIPS_CAP, StartedTrip, NewTrip, IdentityTrips
- `linked-identities.ts`: ProviderLink, LinkedIdentities, refused
- `one-time-passwords.ts`: newOneTimePassword
- `openid-connect-providers.ts`: OpenIdConnectProviderShown, OpenIdConnectProviders
- `passkey-sign-in.ts`: PasskeySignInStart, PasskeySignIn
- `passkeys.ts`: Passkeys
- `password-checks.ts`: PasswordChecks
- `password-sign-in.ts`: PasswordSignIn
- `passwords.ts`: Passwords
- `pending-sign-ins.ts`: PendingSignIns
- `recovery-code-secrets.ts`: newRecoveryCodes, recoveryCodeHashOf
- `sign-in-tokens.ts`: newSignInToken, tokenHashOf
- `sign-in-ways.ts`: OfferedWay, UnavailableWay, WaysAt, SignInWays
- `sign-ins.ts`: SignedInOutcome, SignInOutcome, SignIns
- `signed-in-devices.ts`: NewSignedInDevice, SignedInDevices
- `unknown-email-tries.ts`: UnknownEmailTries
- `user-wrong-tries.ts`: TakenTry, UserWrongTries
- `users.ts`: AddedUser, Users
- Tests: earlier-records-claims.test.ts, password-sign-in.test.ts, sign-ins.test.ts

### domain/

- `address-kind.ts`: AddressKind, ADDRESS_KINDS
- `authenticator.ts`: Authenticator, isOn, timeStepAt, matchingStep, keyUriOf
- `first-run-setup.ts`: FirstRunSetupState, BasicsState, NO_FIRST_RUN_SETUP, isTokenWaiting, basicsOf, withSetupToken, afterFirstUser, withBasicsClosed
- `google-client.ts`: GoogleClient, GoogleClientEntry, googleClientOf
- `identity-refused.ts`: IdentityRefusal, IdentityRefused
- `identity-trip.ts`: IDENTITY_TRIP_MS, TripPurpose, IdentityTrip, isUnderway, ownPathOr
- `linked-identity.ts`: IdentityProviderId, providerNameOf, ProviderIdentity, LinkedIdentity, linkedIdentityOf, signedInWith
- `one-time-password.ts`: ONE_TIME_PASSWORD_ALPHABET, ONE_TIME_PASSWORD_LENGTH, groupedOneTimePassword, oneTimePasswordAsTyped
- `openid-connect-provider.ts`: OpenIdConnectProvider, OpenIdConnectProviderEntry, DiscoveredProvider, NAME_MAX_LENGTH, openIdConnectEntryOf, openIdConnectProviderOf, isAnotherIssuer, isSecureEnough
- `page-address.ts`: PageAddress
- `passkey.ts`: Passkey, NewCredential, PASSKEY_NAME_MAX_LENGTH, passkeyNameProblems, passkeyOf, renamed, usedAt, isPossibleClone, userHandleOf
- `pending-ceremony.ts`: PendingCeremony, addingCeremonyOf, signingInCeremonyOf, isPending, sameRelyingParty
- `pending-sign-in.ts`: PendingSignIn, PENDING_SIGN_IN_SECONDS, pendingSignInOf, isPending
- `recovery-code.ts`: RECOVERY_CODE_COUNT, RECOVERY_CODE_ALPHABET, RECOVERY_CODE_LENGTH, shownRecoveryCode, normalisedRecoveryCode
- `relying-party.ts`: RelyingParty, RelyingPartyAt, relyingPartyAt, PasskeyAt, passkeyAt
- `setup-token.ts`: SETUP_TOKEN_LENGTH, SETUP_TOKEN_ALPHABET, shownSetupToken, setupTokenAsTyped
- `sign-in-refused.ts`: SignInRefusal, TriedWith, SignInRefused
- `sign-in-way.ts`: SignInWayKind, WayUnavailableReason, WayUnavailable, SignInWay, PASSWORD_WAY, secureNameMissingAt, PASSKEY_WAY
- `signed-in-device.ts`: SignedInDevice, SignInRequest, signedInDeviceOf, isSignedIn, seenAt
- `user-events.ts`: UserCreated, UserChanged, UserRemoved, SignedIn, SignedOut, PasswordSet, AuthenticatorSetUp, AuthenticatorRemoved, RecoveryCodesMade, RecoveryCodeUsed, PasskeyAdded, PasskeyRenamed, PasskeyRemoved, IdentityLinked, IdentityUnlinked, GoogleClientSaved, GoogleClientRemoved, OpenIdConnectProviderSaved, OpenIdConnectProviderRemoved, SetupTokenMade, FirstRunBasicsClosed
- `user-refused.ts`: UserRefused, FirstUserExists, UserNotFound, PendingSignInEnded, UserIdNotFound, SignedInDeviceNotFound, PasskeyNotFound, LinkedIdentityNotFound, SetupTokenRefused
- `user.ts`: User, Appearance, DEFAULT_APPEARANCE, Profile, NewUser, newUserProblems, profileProblems, passwordProblems, keptEmail, sameEmail, userOf, addedUserOf, withPassword, withOneTimePassword, isWaitingForFirstSignIn, isOneTimePasswordExpired, withProfile, withAppearance, removalProblems, removed
- `wrong-tries.ts`: WrongTries, NO_WRONG_TRIES, tryRefusal, afterWrongTry, wrongTryAnswer
- Tests: openid-connect-provider.test.ts, relying-party.test.ts

### ports/

- `authenticator-repository.ts`: AuthenticatorRepository
- `first-run-setup-repository.ts`: FirstRunSetupRepository
- `google-client-repository.fixtures.ts`: InMemoryGoogleClientRepository, googleClientForTests
- `google-client-repository.ts`: GoogleClientRepository
- `identity-provider.ts`: IdentityAuthorization, IdentityReturn, ProviderAnswer, IdentityProvider, IdentityProviderFailed
- `linked-identity-repository.ts`: LinkedIdentityRepository
- `openid-connect-discovery.fixtures.ts`: FakeOpenIdConnectDiscovery, openIdConnectDiscoveryForTests
- `openid-connect-discovery.ts`: OpenIdConnectDiscovery, OpenIdConnectDiscoveryFailed
- `openid-connect-provider-repository.fixtures.ts`: InMemoryOpenIdConnectProviderRepository, openIdConnectProviderForTests
- `openid-connect-provider-repository.ts`: OpenIdConnectProviderRepository
- `passkey-ceremonies.ts`: CeremonyStart, CeremonyAnswer, PasskeyCeremonies
- `passkey-repository.ts`: PasskeyRepository
- `password-hashing.ts`: PasswordHashing
- `pending-ceremonies.ts`: PendingCeremonies
- `pending-sign-in-repository.ts`: PendingSignInRepository
- `second-steps.ts`: SecondStep, SecondSteps
- `signed-in-device-repository.ts`: SignedInDeviceRepository
- `user-repository.ts`: UserRepository

# Users: module map

**Owns:** users and signing in (spec §2.10): `users` (name, email kept as typed and unique ignoring case among users not removed, a scrypt password hash `scrypt$N$r$p$salt$key` from `ScryptPasswordHashing`, `one_time_password_expires_at` set while that hash is a one-time password's, the wrong tries: how many in a row, the next try allowed at, locked until; `palette` and `density`, null for Follow the system and Comfortable; `removed_at`) and `signed_in_devices` (one row per browser signed in: the SHA-256 of its token only, its user agent and address kind, signed in, last seen and expires, 30 days after the last use, both written at most once a minute). The first user (`FirstUser`, `POST /sign-in/first-user`) is made only while no user was ever made, removed ones counted, in one transaction, so two at once make one. `Users` (Settings › Users, `/users`) lists the users not removed, adds one with a one-time password (`domain/one-time-password.ts`: 16 characters without look-alikes, shown grouped by four, hashed as typed without dashes in capitals, answered once and kept nowhere; it works 7 days, and a waiting user's can be made anew, which ends the old), and removes one: `removeAmongActive` locks every user not removed in id order and refuses yourself and a remover removed meanwhile, so two users removing each other leave one; the row stays, its password hash cleared, so `namesOf` still reads the name, its email free again; then `SignedInDevices.signOutAll`. `PasswordChecks` checks any password, a one-time one included: it counts a try wrong before checking and clears the count once it matches; `domain/wrong-tries.ts` holds the Defaults (3 free tries, then waits of 2, 4, 8 and 16 s answered as 429 with when to try again, never slept on; the 10th in a row locks for 15 minutes, doubling up to a day). An unknown or removed user's email gets the same answers, hashed against a dummy (`UnknownEmailTries`, in memory). `PasswordSignIn` signs in with it; a right one-time password answers `set-password` and makes no device (`expired` past its days), and `FirstPassword` (`POST /sign-in/set-password`) takes it again with the user's own, under the same checks, and ends in `SignIns.finish`. `Accounts` answers `/account`: the profile, a password change (the current one under the same checks, answered "The current password is wrong."; it signs out every other device) and the appearance. `SignedInDevices` lists, checks and signs out devices; a removed user's devices sign in nothing (`findByTokenHash` joins the user). `Passwords` sets a password (the host's `npm run set-password`, `src/set-password.ts`), lifting the lockout and the one-time password and signing out every device. The cookie (`adapters/http/sign-in-cookie.ts`, `office_signed_in`) is `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` only when the request came through the public address over https. **Passkeys** (`passkeys`: credential id base64url and unique, public key as bytea, counter, transports, name, rp id, device type, backed up, created and last used; rows go on `UserRemoved` and cascade with the row): the relying party is the page's own address (`domain/relying-party.ts`'s `relyingPartyAt`, from the `PageAddress` the HTTP adapter builds with `pageAddressOf`: `localhost` with the checked Host's origin, or the public address's hostname and origin over HTTPS, never the request's Origin; a loopback IP answers `ip-address` with a link to `localhost` at its port, a local network IP, plain HTTP at the public address or a public address that is an IP `needs-https-domain`), and `passkeyAt` tells each passkey's rp id against it (this, the other or an old address). `Passkeys` (`/account/passkeys`) lists, starts adding after the current password (`PasswordChecks.currentUserOf`, shared with the password change), finishes adding, renames (1–60 characters) and removes the user's own (another's is `PasskeyNotFound`, 404); `PasskeySignIn` (`/sign-in/passkey`) starts a discoverable ceremony under a random key its `office_passkey_ceremony` cookie carries (`HttpOnly`, `SameSite=Strict`, `Path=/api/sign-in/passkey`, 5 minutes), then takes it, finds the passkey by credential id, checks its rp id is this address's and the user handle (`userHandleOf`, the user's id as bytes) its user's, verifies, refuses a counter that didn't go up when either isn't 0 (`isPossibleClone`, logged as a possible copy), saves counter and last use and ends in `SignIns.finish(user, "passkey")`; every failure is `SignInRefused.passkey()`, and the password's lockout doesn't stop it. The ceremonies (`PasskeyCeremonies`, bound to `adapters/webauthn/`'s `SimpleWebAuthnPasskeyCeremonies` over `@simplewebauthn/server` 14: no attestation, discoverable, user verification required) and the pending ones (`PendingCeremonies`, in memory, `adapters/in-memory/`, at most 1000, expired then oldest dropped, each taken once, 5 minutes by the `Schedule`; adding keyed by the signed-in device, so another device can't finish it). **Linked identities** (`linked_identities`: provider, `subject` (the provider's own id for the person, GitHub's numeric user id as text), `name` (the GitHub login, display only, updated at each sign-in and each link again), linked at, last signed in at; unique on (provider, subject) and (user, provider); rows go on `UserRemoved` and cascade with the row): `LinkedIdentities` (`/account/linked-identities`) lists each bound provider with whether it is set up and the user's identity there, starts linking (a trip tied to the user and signed-in device, returning to `/account/linked-identities`), links (again as the same user only takes the new name; one linked to another user is refused without saying whose, a second of the same provider is refused, a race on either unique index is caught by `onConflictDoNothing`) and unlinks (`IdentityLinked`, `IdentityUnlinked`). **Continue with GitHub** (`IdentitySignIns`, `/sign-in/github`): the start answers the provider's authorize URL and sets the trip cookie (`office_identity_trip`, the nonce whose SHA-256 the trip keeps: `HttpOnly`, `SameSite=Lax`, `Path=/api/sign-in`, 10 minutes, `Secure` over HTTPS); `GET /sign-in/github/callback` is the one callback for signing in and linking (one URL per address to list on GitHub): it takes the trip by its state (`IdentityTrips`, in memory, at most 1000, 10 minutes, each taken once), checks a sign-in's trip cookie or a link's signed-in device (read here through `CookieSignedInRequests`, as the guard skips `/sign-in`), asks the provider who it is, then links, or finds the user only by (provider, subject), never by email or login (a removed user is refused as not linked) and ends in `SignIns.finish(user, "github", request)`; it always redirects: signed in to `returnTo` (a path of The Office's own only, `ownPathOr`, else `/`), linked to the account, refused to `/sign-in?signInFailed=` or `/account/linked-identities?linkFailed=` with why (an unknown trip goes to the account when the browser is signed in). The redirect URI is the page's address (`identity-callback-urls.ts`): the request's protocol and checked Host, or the configured public address there; `GET /account/identity-callback-urls/github` answers this address's and the public address's for Settings › Office identity.

**Extension points:** `SignIns.finish(user, way, request)` is where every way of signing in ends: it asks the `SecondSteps` port (bound to `NoSecondSteps`; the authenticator Task binds its own) only when the way isn't `enoughAlone` (`SignInWays.isEnoughAlone`; only a passkey is), and makes the signed-in device. `SignInWays` is the registry of ways (`SignInWay`: its kind, `enoughAlone`, `unavailableAt(page)` with a reason and where it works instead, whether it is set up); `password` and `passkey` are built in, a later way's module `add`s itself, and `GET /sign-in` lists those that work at the page's address and, as `unavailable`, those set up that don't, with `reason` and `elsewhere`, which Continue with Google reuses. **`IdentityProvider`** (`ports/identity-provider.ts`: `provider`, `isAvailable`, `unavailableAt(page)`, `authorizeUrl`, `identityOf`, failures as `IdentityProviderFailed`) is the extension point for Continue with Google: `UsersModule.register({ imports, identityProviders })` binds each adapter (`GitHubIdentityProvider` in `adapters/github/`, over the github module's `GitHubIdentities`), `IdentityProviders` lists them, and `IdentitySignIns` adds each as a way (never enough alone); Google adds `"google"` to `IdentityProviderId` and the contracts' `identityProviderSchema`, an adapter, and its own explicit `/sign-in/google` and `/account/linked-identities/google` routes (no `:provider` route, which would shadow `/sign-in/password`), reusing `IdentityTrips`, the trip cookie, the device check and the linked identities. Contracts' `SignInWay` and the sign-in answer's `outcome` are discriminated unions (`password`, `passkey` and `github`, and `signed-in` and `set-password`, now), as is the web's way-kind map (`surfaces/sign-in/sign-in-ways.tsx`). Every later way's callback lives under `/api/sign-in/`, the only path open without a signed-in device.

**Talks to:** the platform's `SignedInRequests` port, bound in `app.module.ts` to `CookieSignedInRequests` through `RequestAccessModule`, which the platform's guard and event stream ask who a request's device is, and whose `onSignedOut` (the `SignedOut` event) closes that device's WebSockets at once, and `signedOutAmong` each minute those of devices signed out by the recovery command's own process or expired; the platform's `OfficeAddresses` for the address kind (`adapters/http/sign-in-request.ts` maps it to the domain's own copy); the `Schedule` for the time; the github module's `GitHubIdentities` (through `GitHubIdentityProvider`), which never touches Sign in with GitHub. Publishes `UserCreated`, `UserChanged`, `UserRemoved`, `SignedIn`, `SignedOut`, `PasswordSet`, `PasskeyAdded`, `PasskeyRenamed`, `PasskeyRemoved`, `IdentityLinked`, `IdentityUnlinked`; `adapters/websocket/user-web-events.ts` forwards the first three to the web. A later Task's own tables of a user's (the authenticator and recovery codes) clean up on `UserRemoved`, as `passkeys` and `linked_identities` do, since the user's row stays and nothing cascades.

**Traps:** a signed-in device is never called a session, in code, API or database. `UserRepository.find` answers removed users too (for the records); everything that signs in or lists goes through `findByEmail`, `listActive` or a check of `removedAt`. `set-password.ts` boots the module without the event stream, so it provides its own `WebEventForwarding`. The domain keeps its own `AddressKind`, since the boundary lint allows it nothing from the platform but `DomainEvent`. Unknown emails' wrong tries are in memory and start again at a restart; a user's are in the database and don't. Other modules' tests boot unguarded (`startTestApplication` binds `EveryoneSignedIn`); a test that needs the guard uses `startUsersApplication` and `signedInCookie` from `index.fixtures.ts`. Passkey tests use `passkeys.fixtures.ts` (pages at `localhost`, `127.0.0.1` and the public address, `addPasskey`) and `adapters/webauthn/software-authenticator.fixtures.ts`, a P-256 key that answers as a browser would, with tampering for origin, rp id, user verification and user handle. The library's own counter check is given 0, since the counter's rule is the domain's; pending ceremonies are lost at a restart, which only means starting again. `UsersModule` is registered once in `app.module.ts` and that one instance is given to `RequestAccessModule` too; `set-password.ts` and `startUsersApplication` register it with no identity provider unless a test binds `FakeIdentityProvider` (`adapters/fake/`, bound as `github`; `linked-identities.fixtures.ts`'s `startWithFakeProvider`, `linkAt`, `continueAt`). The `linked_identities` table is shared by every test of a run, so a test's provider identity takes a random subject. A redirect URI mismatch is sent by GitHub to the App's first callback URL, Sign in with GitHub's, so its page words it (the github module's map).

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

GitHubIdentityProvider, CookieSignedInRequests, Accounts, Passwords, SignInWays, SignIns, SignInOutcome, SignedInDevices, Users, AddressKind, SignInRequest, SignInWay, SignInWayKind, IdentityLinked, IdentityUnlinked, PasswordSet, SignedIn, SignedOut, UserChanged, UserCreated, UserRemoved, UserNotFound, UserRefused, UsersModule, UsersModuleOptions

## Domain events

- `domain/user-events.ts`: UserCreated, UserChanged, UserRemoved, SignedIn, SignedOut, PasswordSet, PasskeyAdded, PasskeyRenamed, PasskeyRemoved, IdentityLinked, IdentityUnlinked

## HTTP routes (under `/api`)

- `POST /sign-out`: AccountController.signOut
- `GET /account`: AccountController.account
- `PATCH /account`: AccountController.changeProfile
- `POST /account/password`: AccountController.changePassword
- `PUT /account/appearance`: AccountController.setAppearance
- `GET /account/signed-in-devices`: AccountController.signedInDeviceList
- `DELETE /account/signed-in-devices/:id`: AccountController.signOutDevice
- `POST /sign-in/github`: IdentitySignInController.startGitHub
- `GET /sign-in/github/callback`: IdentitySignInController.gitHubReturned
- `GET /account/linked-identities`: LinkedIdentitiesController.list
- `POST /account/linked-identities/github`: LinkedIdentitiesController.linkGitHub
- `DELETE /account/linked-identities/github`: LinkedIdentitiesController.unlinkGitHub
- `GET /account/identity-callback-urls/github`: LinkedIdentitiesController.gitHubCallbackUrls
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
- `POST /sign-in/set-password`: SignInController.setPassword
- `GET /users`: UsersController.list
- `POST /users`: UsersController.add
- `POST /users/:userId/one-time-password`: UsersController.newOneTimePassword
- `DELETE /users/:userId`: UsersController.remove

## Tables

- `adapters/postgres/linked-identities.schema.ts`: linked_identities
- `adapters/postgres/passkeys.schema.ts`: passkeys
- `adapters/postgres/users.schema.ts`: users, signed_in_devices

## Files

### ./

- `index.fixtures.ts`: A_PASSWORD, UserForTests, addUser, signedInCookie, send, setCookieOf, startUsersApplication, UsersApplication
- `linked-identities.fixtures.ts`: OfficeWithProvider, startWithFakeProvider, cookieNamed, stateOf, backFromProvider, startLinking, linkAt, startSignIn, continueAt, locationOf
- `passkeys.fixtures.ts`: PageAt, atLocalhost, atLoopbackIp, atPublicAddress, sendFrom, signedInAt, addingOptions, addPasskey, SoftwareAuthenticator
- `users-application.fixtures.ts`: PUBLIC_ADDRESS, UsersApplication, UsersApplicationOptions, startUsersApplication, Sent, Answer, send, setCookieOf
- `users.module.ts`: UsersModuleOptions, UsersModule

### adapters/crypto/

- `scrypt-password-hashing.ts`: ScryptPasswordHashing
- Tests: scrypt-password-hashing.test.ts

### adapters/fake/

- `fake-identity-provider.fixtures.ts`: FAKE_AUTHORIZE_URL, FakeIdentityProvider

### adapters/github/

- `github-identity-provider.ts`: GitHubIdentityProvider
- Tests: github-identity-provider.test.ts

### adapters/http/

- `account.controller.ts`: AccountController
- `cookie-signed-in-requests.ts`: CookieSignedInRequests
- `identity-callback-urls.ts`: pageOriginOf, identityCallbackUrlOf, identityCallbackUrlsOf
- `identity-sign-in.controller.ts`: IdentitySignInController
- `identity-trip-cookie.ts`: IDENTITY_TRIP_COOKIE, identityTripCookie, clearedIdentityTripCookie
- `linked-identities.controller.ts`: LinkedIdentitiesController
- `passkey-ceremony-cookie.ts`: PASSKEY_CEREMONY_COOKIE, passkeyCeremonyCookie, clearedPasskeyCeremonyCookie
- `passkey-messages.ts`: ceremonyAnswerOf, passkeyMessageOf
- `passkey-sign-in.controller.ts`: PasskeySignInController
- `passkeys.controller.ts`: PasskeysController
- `sign-in-answer.ts`: answered
- `sign-in-cookie.ts`: SIGN_IN_COOKIE, signInCookie, clearedSignInCookie, signInTokenOf, cookieValueOf
- `sign-in-request.ts`: addressKindOf, pageAddressOf, signInRequestOf
- `sign-in.controller.ts`: SignInController
- `user-refusals.filter.ts`: UserRefusalsFilter
- `users.controller.ts`: UsersController
- Tests: account.controller.test.ts, identity-sign-in.controller.test.ts, linked-identities.controller.test.ts, passkey-sign-in.controller.test.ts, passkeys.controller.test.ts, sign-in.controller.test.ts, users.controller.test.ts

### adapters/in-memory/

- `in-memory-pending-ceremonies.ts`: PENDING_CEREMONIES_CAP, InMemoryPendingCeremonies
- Tests: in-memory-pending-ceremonies.test.ts

### adapters/postgres/

- `linked-identities.schema.ts`: linkedIdentities
- `passkeys.schema.ts`: passkeys
- `postgres-linked-identity-repository.ts`: PostgresLinkedIdentityRepository
- `postgres-passkey-repository.ts`: PostgresPasskeyRepository
- `postgres-signed-in-device-repository.ts`: PostgresSignedInDeviceRepository
- `postgres-user-repository.ts`: PostgresUserRepository
- `users.schema.ts`: users, signedInDevices
- Tests: postgres-passkey-repository.test.ts

### adapters/second-steps/

- `no-second-steps.ts`: NoSecondSteps

### adapters/webauthn/

- `simple-webauthn-passkey-ceremonies.ts`: SimpleWebAuthnPasskeyCeremonies
- `software-authenticator.fixtures.ts`: Tampering, SoftwareAuthenticator

### adapters/websocket/

- `user-web-events.ts`: UserWebEvents

### application/

- `accounts.ts`: PasswordChange, Accounts
- `first-password.ts`: FirstPasswordRequest, FirstPassword
- `first-user.ts`: FirstUser
- `identity-providers.ts`: IdentityProviders
- `identity-sign-ins.ts`: IdentitySignInStart, ProviderReturn, ReturningBrowser, IdentityReturnOutcome, IdentitySignIns
- `identity-trips.ts`: IDENTITY_TRIPS_CAP, StartedTrip, NewTrip, IdentityTrips
- `linked-identities.ts`: ProviderLink, LinkedIdentities, refused
- `one-time-passwords.ts`: newOneTimePassword
- `passkey-sign-in.ts`: PasskeySignInStart, PasskeySignIn
- `passkeys.ts`: Passkeys
- `password-checks.ts`: PasswordChecks
- `password-sign-in.ts`: PasswordSignIn
- `passwords.ts`: Passwords
- `sign-in-tokens.ts`: newSignInToken, tokenHashOf
- `sign-in-ways.ts`: UnavailableWay, WaysAt, SignInWays
- `sign-ins.ts`: SignedInOutcome, SignInOutcome, SignIns
- `signed-in-devices.ts`: NewSignedInDevice, SignedInDevices
- `unknown-email-tries.ts`: UnknownEmailTries
- `users.ts`: AddedUser, Users
- Tests: password-sign-in.test.ts, sign-ins.test.ts

### domain/

- `address-kind.ts`: AddressKind, ADDRESS_KINDS
- `identity-refused.ts`: IdentityRefusal, IdentityRefused
- `identity-trip.ts`: IDENTITY_TRIP_MS, TripPurpose, IdentityTrip, isUnderway, ownPathOr
- `linked-identity.ts`: IdentityProviderId, providerNameOf, ProviderIdentity, LinkedIdentity, linkedIdentityOf, signedInWith
- `one-time-password.ts`: ONE_TIME_PASSWORD_ALPHABET, ONE_TIME_PASSWORD_LENGTH, groupedOneTimePassword, oneTimePasswordAsTyped
- `page-address.ts`: PageAddress
- `passkey.ts`: Passkey, NewCredential, PASSKEY_NAME_MAX_LENGTH, passkeyNameProblems, passkeyOf, renamed, usedAt, isPossibleClone, userHandleOf
- `pending-ceremony.ts`: PendingCeremony, addingCeremonyOf, signingInCeremonyOf, isPending, sameRelyingParty
- `relying-party.ts`: RelyingParty, RelyingPartyAt, relyingPartyAt, PasskeyAt, passkeyAt
- `sign-in-refused.ts`: SignInRefusal, SignInRefused
- `sign-in-way.ts`: SignInWayKind, WayUnavailableReason, WayUnavailable, SignInWay, PASSWORD_WAY, PASSKEY_WAY
- `signed-in-device.ts`: SignedInDevice, SignInRequest, signedInDeviceOf, isSignedIn, seenAt
- `user-events.ts`: UserCreated, UserChanged, UserRemoved, SignedIn, SignedOut, PasswordSet, PasskeyAdded, PasskeyRenamed, PasskeyRemoved, IdentityLinked, IdentityUnlinked
- `user-refused.ts`: UserRefused, FirstUserExists, UserNotFound, UserIdNotFound, SignedInDeviceNotFound, PasskeyNotFound, LinkedIdentityNotFound
- `user.ts`: User, Appearance, DEFAULT_APPEARANCE, Profile, NewUser, newUserProblems, profileProblems, passwordProblems, keptEmail, sameEmail, userOf, addedUserOf, withPassword, withOneTimePassword, isWaitingForFirstSignIn, isOneTimePasswordExpired, withProfile, withAppearance, removalProblems, removed
- `wrong-tries.ts`: WrongTries, NO_WRONG_TRIES, tryRefusal, afterWrongTry, wrongTryAnswer
- Tests: relying-party.test.ts

### ports/

- `identity-provider.ts`: IdentityAuthorization, IdentityReturn, ProviderAnswer, IdentityProvider, IdentityProviderFailed
- `linked-identity-repository.ts`: LinkedIdentityRepository
- `passkey-ceremonies.ts`: CeremonyStart, CeremonyAnswer, PasskeyCeremonies
- `passkey-repository.ts`: PasskeyRepository
- `password-hashing.ts`: PasswordHashing
- `pending-ceremonies.ts`: PendingCeremonies
- `second-steps.ts`: SecondStep, SecondSteps
- `signed-in-device-repository.ts`: SignedInDeviceRepository
- `user-repository.ts`: UserRepository

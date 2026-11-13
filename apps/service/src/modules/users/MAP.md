# Users: module map

**Owns:** users and signing in (spec §2.10): `users` (name, email kept as typed and unique ignoring case among users not removed, a scrypt password hash `scrypt$N$r$p$salt$key` from `ScryptPasswordHashing`, `one_time_password_expires_at` set while that hash is a one-time password's, the wrong tries: how many in a row, the next try allowed at, locked until; `palette` and `density`, null for Follow the system and Comfortable; `removed_at`) and `signed_in_devices` (one row per browser signed in: the SHA-256 of its token only, its user agent and address kind, signed in, last seen and expires, 30 days after the last use, both written at most once a minute). The first user (`FirstUser`, `POST /sign-in/first-user`) is made only while no user was ever made, removed ones counted, in one transaction, so two at once make one. `Users` (Settings › Users, `/users`) lists the users not removed, adds one with a one-time password (`domain/one-time-password.ts`: 16 characters without look-alikes, shown grouped by four, hashed as typed without dashes in capitals, answered once and kept nowhere; it works 7 days, and a waiting user's can be made anew, which ends the old), and removes one: `removeAmongActive` locks every user not removed in id order and refuses yourself and a remover removed meanwhile, so two users removing each other leave one; the row stays, its password hash cleared, so `namesOf` still reads the name, its email free again; then `SignedInDevices.signOutAll`. `PasswordChecks` checks any password, a one-time one included: it counts a try wrong before checking and clears the count once it matches; `domain/wrong-tries.ts` holds the Defaults (3 free tries, then waits of 2, 4, 8 and 16 s answered as 429 with when to try again, never slept on; the 10th in a row locks for 15 minutes, doubling up to a day). An unknown or removed user's email gets the same answers, hashed against a dummy (`UnknownEmailTries`, in memory). `PasswordSignIn` signs in with it; a right one-time password answers `set-password` and makes no device (`expired` past its days), and `FirstPassword` (`POST /sign-in/set-password`) takes it again with the user's own, under the same checks, and ends in `SignIns.finish`. `Accounts` answers `/account`: the profile, a password change (the current one under the same checks, answered "The current password is wrong."; it signs out every other device) and the appearance. `SignedInDevices` lists, checks and signs out devices; a removed user's devices sign in nothing (`findByTokenHash` joins the user). `Passwords` sets a password (the host's `npm run set-password`, `src/set-password.ts`), lifting the lockout and the one-time password and signing out every device. The cookie (`adapters/http/sign-in-cookie.ts`, `office_signed_in`) is `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` only when the request came through the public address over https. **Passkeys** (`passkeys`: credential id base64url and unique, public key as bytea, counter, transports, name, rp id, device type, backed up, created and last used; rows go on `UserRemoved` and cascade with the row): the relying party is the page's own address (`domain/relying-party.ts`'s `relyingPartyAt`, from the `PageAddress` the HTTP adapter builds with `pageAddressOf`: `localhost` with the checked Host's origin, or the public address's hostname and origin over HTTPS, never the request's Origin; a loopback IP answers `ip-address` with a link to `localhost` at its port, a local network IP, plain HTTP at the public address or a public address that is an IP `needs-https-domain`), and `passkeyAt` tells each passkey's rp id against it (this, the other or an old address). `Passkeys` (`/account/passkeys`) lists, starts adding after the current password (`PasswordChecks.currentUserOf`, shared with the password change), finishes adding, renames (1–60 characters) and removes the user's own (another's is `PasskeyNotFound`, 404); `PasskeySignIn` (`/sign-in/passkey`) starts a discoverable ceremony under a random key its `office_passkey_ceremony` cookie carries (`HttpOnly`, `SameSite=Strict`, `Path=/api/sign-in/passkey`, 5 minutes), then takes it, finds the passkey by credential id, checks its rp id is this address's and the user handle (`userHandleOf`, the user's id as bytes) its user's, verifies, refuses a counter that didn't go up when either isn't 0 (`isPossibleClone`, logged as a possible copy), saves counter and last use and ends in `SignIns.finish(user, PASSKEY_WAY)`; every failure is `SignInRefused.passkey()`, and the password's lockout doesn't stop it. The ceremonies (`PasskeyCeremonies`, bound to `adapters/webauthn/`'s `SimpleWebAuthnPasskeyCeremonies` over `@simplewebauthn/server` 14: no attestation, discoverable, user verification required) and the pending ones (`PendingCeremonies`, in memory, `adapters/in-memory/`, at most 1000, expired then oldest dropped, each taken once, 5 minutes by the `Schedule`; adding keyed by the signed-in device, so another device can't finish it).

**The authenticator** (spec §2.10 Defaults): `authenticators` (one per user: the TOTP secret in base32, readable since codes are checked against it, confirmed at, the last time step whose code was taken) and `recovery_codes` (SHA-256 of the normalised code only, used at), kept together by `AuthenticatorRepository`. `Authenticators` sets one up (`POST /account/authenticator`: a new secret in place of any unconfirmed one, its `otpauth://` address and key sent only then), turns it on with a first code (`/confirm`, answering 10 recovery codes once, `XXXXX-XXXXX` from `domain/recovery-code.ts`'s alphabet without look-alikes), turns it off (`DELETE`, with a code or a recovery code) and makes new recovery codes (`POST /account/recovery-codes`, with a code); `npm run set-password -- --clear-authenticator` removes it with its recovery codes through `Authenticators.remove`, the new password having lifted the lockout; `GET /account` says `off` or `on` with the recovery codes left. `domain/authenticator.ts` checks a code at the `Schedule`'s time, one step either side, never a step at or before the last taken (`takeStep` is a conditional UPDATE, so two requests can't both take one). `AuthenticatorCodes` checks a code or a recovery code for every use, counted by `UserWrongTries` on the user's one count of wrong tries (spec: "the user's password and codes are locked"), cleared by a right code; `PasswordChecks` counts passwords (signing in, the first password, Change password) on the same count, and a right password undoes only its own try (`UserWrongTries.undo`), so it never resets wrong codes before it.

**The code step:** `SecondSteps` is bound to `AuthenticatorSecondStep`: after a way not `enoughAlone` (a `SignInWay` flag; only the passkey's is true), a user whose authenticator is on gets a pending sign-in (`pending_sign_ins`: the SHA-256 of its token, 5 minutes) instead of a signed-in device, and the outcome `code-needed`; a right one-time password answers `set-password` before any of this, and the first password then ends in `SignIns.finish` too. `adapters/http/sign-in-answers.ts` writes every way's answer: `answerSignIn` in the body, `redirectSignIn` for a callback (to `/sign-in/code?returnTo=…` when the code is needed); the pending token travels only in `office_pending_sign_in` (`HttpOnly`, `SameSite=Lax`, `Path=/api/sign-in`, `Max-Age=300`). `POST /sign-in/code` (`CodeSignIn`) checks the code, uses the pending sign-in up and signs the device in through `SignIns.signIn`, which clears the wrong tries; an ended pending sign-in answers 401.

**Extension points:** `SignIns.finish(user, way, request)` is where every way of signing in ends, given the `SignInWay` itself: unless the way is `enoughAlone` (only a passkey is), it asks the `SecondSteps` port, then makes the signed-in device; a later way answers its callback with `redirectSignIn`. `SignInWays` is the registry of ways (`SignInWay`: its kind, `enoughAlone`, `unavailableAt(page)` with a reason and where it works instead, whether it is set up); `password` and `passkey` are built in, a later way's module `add`s itself, and `GET /sign-in` lists those that work at the page's address and, as `unavailable`, those set up that don't, with `reason` and `elsewhere`, which Continue with Google reuses. Contracts' `SignInWay` and the sign-in answer's `outcome` are discriminated unions (`password` and `passkey`; `signed-in`, `code-needed` and `set-password`), as is the web's way-kind map (`surfaces/sign-in/sign-in-ways.tsx`). Every later way's callback lives under `/api/sign-in/`, the only path open without a signed-in device.

**Talks to:** the platform's `SignedInRequests` port, bound in `app.module.ts` to `CookieSignedInRequests` through `RequestAccessModule`, which the platform's guard and event stream ask who a request's device is, and whose `onSignedOut` (the `SignedOut` event) closes that device's WebSockets at once, and `signedOutAmong` each minute those of devices signed out by the recovery command's own process or expired; the platform's `OfficeAddresses` for the address kind (`adapters/http/sign-in-request.ts` maps it to the domain's own copy); the `Schedule` for the time. Publishes `UserCreated`, `UserChanged`, `UserRemoved`, `SignedIn`, `SignedOut`, `PasswordSet`, `AuthenticatorSetUp`, `AuthenticatorRemoved`, `RecoveryCodesMade`, `RecoveryCodeUsed`, `PasskeyAdded`, `PasskeyRenamed`, `PasskeyRemoved`, none carrying a secret, token or code; `adapters/websocket/user-web-events.ts` forwards the first three to the web. A later Task's own tables of a user's (linked identities) clean up on `UserRemoved`, as `passkeys` does, since the user's row stays and nothing cascades; `Users.remove` itself ends the user's pending sign-ins and removes their authenticator and recovery codes.

**Traps:** a signed-in device is never called a session, in code, API or database. `UserRepository.find` answers removed users too (for the records); everything that signs in or lists goes through `findByEmail`, `listActive` or a check of `removedAt`. `set-password.ts` boots the module without the event stream, so it provides its own `WebEventForwarding`. The domain keeps its own `AddressKind`, since the boundary lint allows it nothing from the platform but `DomainEvent`. Unknown emails' wrong tries are in memory and start again at a restart; a user's are in the database and don't. Other modules' tests boot unguarded (`startTestApplication` binds `EveryoneSignedIn`); a test that needs the guard uses `startUsersApplication` and `signedInCookie` from `index.fixtures.ts`, and `turnOnAuthenticator` and `authenticatorCodeOf` for a user with an authenticator; a code of the confirming step is taken already, so the next sign-in uses the next step's code (`ManualSchedule.advanceBy` 30 s, or one step of drift). The fixtures' `send` gives a body's Content-Length, without which Node sends no DELETE body. A pending sign-in is never called a session. Passkey tests use `passkeys.fixtures.ts` (pages at `localhost`, `127.0.0.1` and the public address, `addPasskey`) and `adapters/webauthn/software-authenticator.fixtures.ts`, a P-256 key that answers as a browser would, with tampering for origin, rp id, user verification and user handle. The library's own counter check is given 0, since the counter's rule is the domain's; pending ceremonies are lost at a restart, which only means starting again.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

CookieSignedInRequests, answerSignIn, redirectSignIn, Accounts, Authenticators, Passwords, SignInWays, SignIns, SignInOutcome, SignedInOutcome, SignedInDevices, Users, AddressKind, SignInRequest, SignInWay, SignInWayKind, AuthenticatorRemoved, AuthenticatorSetUp, PasswordSet, RecoveryCodeUsed, RecoveryCodesMade, SignedIn, SignedOut, UserChanged, UserCreated, UserRemoved, UserNotFound, UserRefused, UsersModule

## Domain events

- `domain/user-events.ts`: UserCreated, UserChanged, UserRemoved, SignedIn, SignedOut, PasswordSet, AuthenticatorSetUp, AuthenticatorRemoved, RecoveryCodesMade, RecoveryCodeUsed, PasskeyAdded, PasskeyRenamed, PasskeyRemoved

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

- `adapters/postgres/passkeys.schema.ts`: passkeys
- `adapters/postgres/users.schema.ts`: users, signed_in_devices, authenticators, recovery_codes, pending_sign_ins

## Files

### ./

- `index.fixtures.ts`: A_PASSWORD, UserForTests, addUser, signedInCookie, authenticatorCodeOf, turnOnAuthenticator, send, setCookieOf, startUsersApplication, UsersApplication
- `passkeys.fixtures.ts`: PageAt, atLocalhost, atLoopbackIp, atPublicAddress, sendFrom, signedInAt, addingOptions, addPasskey, SoftwareAuthenticator
- `users-application.fixtures.ts`: PUBLIC_ADDRESS, testPasswordHashing, UsersApplication, UsersApplicationOptions, startUsersApplication, Sent, Answer, send, setCookieOf
- `users.module.ts`: UsersModule

### adapters/crypto/

- `scrypt-password-hashing.ts`: ScryptPasswordHashing
- Tests: scrypt-password-hashing.test.ts

### adapters/http/

- `account.controller.ts`: AccountController
- `cookie-signed-in-requests.ts`: CookieSignedInRequests
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
- Tests: account.controller.test.ts, authenticator.test.ts, passkey-sign-in.controller.test.ts, passkeys.controller.test.ts, sign-in-answers.test.ts, sign-in.controller.test.ts, users.controller.test.ts

### adapters/in-memory/

- `in-memory-pending-ceremonies.ts`: PENDING_CEREMONIES_CAP, InMemoryPendingCeremonies
- Tests: in-memory-pending-ceremonies.test.ts

### adapters/postgres/

- `passkeys.schema.ts`: passkeys
- `postgres-authenticator-repository.ts`: PostgresAuthenticatorRepository
- `postgres-passkey-repository.ts`: PostgresPasskeyRepository
- `postgres-pending-sign-in-repository.ts`: PostgresPendingSignInRepository
- `postgres-signed-in-device-repository.ts`: PostgresSignedInDeviceRepository
- `postgres-user-repository.ts`: PostgresUserRepository
- `users.schema.ts`: users, signedInDevices, authenticators, recoveryCodes, pendingSignIns
- Tests: postgres-passkey-repository.test.ts

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
- `first-password.ts`: FirstPasswordRequest, FirstPassword
- `first-user.ts`: FirstUser
- `one-time-passwords.ts`: newOneTimePassword
- `passkey-sign-in.ts`: PasskeySignInStart, PasskeySignIn
- `passkeys.ts`: Passkeys
- `password-checks.ts`: PasswordChecks
- `password-sign-in.ts`: PasswordSignIn
- `passwords.ts`: Passwords
- `pending-sign-ins.ts`: PendingSignIns
- `recovery-code-secrets.ts`: newRecoveryCodes, recoveryCodeHashOf
- `sign-in-tokens.ts`: newSignInToken, tokenHashOf
- `sign-in-ways.ts`: UnavailableWay, WaysAt, SignInWays
- `sign-ins.ts`: SignedInOutcome, SignInOutcome, SignIns
- `signed-in-devices.ts`: NewSignedInDevice, SignedInDevices
- `unknown-email-tries.ts`: UnknownEmailTries
- `user-wrong-tries.ts`: TakenTry, UserWrongTries
- `users.ts`: AddedUser, Users
- Tests: password-sign-in.test.ts, sign-ins.test.ts

### domain/

- `address-kind.ts`: AddressKind, ADDRESS_KINDS
- `authenticator.ts`: Authenticator, isOn, timeStepAt, matchingStep, keyUriOf
- `one-time-password.ts`: ONE_TIME_PASSWORD_ALPHABET, ONE_TIME_PASSWORD_LENGTH, groupedOneTimePassword, oneTimePasswordAsTyped
- `page-address.ts`: PageAddress
- `passkey.ts`: Passkey, NewCredential, PASSKEY_NAME_MAX_LENGTH, passkeyNameProblems, passkeyOf, renamed, usedAt, isPossibleClone, userHandleOf
- `pending-ceremony.ts`: PendingCeremony, addingCeremonyOf, signingInCeremonyOf, isPending, sameRelyingParty
- `pending-sign-in.ts`: PendingSignIn, PENDING_SIGN_IN_SECONDS, pendingSignInOf, isPending
- `recovery-code.ts`: RECOVERY_CODE_COUNT, RECOVERY_CODE_ALPHABET, RECOVERY_CODE_LENGTH, shownRecoveryCode, normalisedRecoveryCode
- `relying-party.ts`: RelyingParty, RelyingPartyAt, relyingPartyAt, PasskeyAt, passkeyAt
- `sign-in-refused.ts`: SignInRefusal, TriedWith, SignInRefused
- `sign-in-way.ts`: SignInWayKind, WayUnavailableReason, WayUnavailable, SignInWay, PASSWORD_WAY, PASSKEY_WAY
- `signed-in-device.ts`: SignedInDevice, SignInRequest, signedInDeviceOf, isSignedIn, seenAt
- `user-events.ts`: UserCreated, UserChanged, UserRemoved, SignedIn, SignedOut, PasswordSet, AuthenticatorSetUp, AuthenticatorRemoved, RecoveryCodesMade, RecoveryCodeUsed, PasskeyAdded, PasskeyRenamed, PasskeyRemoved
- `user-refused.ts`: UserRefused, FirstUserExists, UserNotFound, PendingSignInEnded, UserIdNotFound, SignedInDeviceNotFound, PasskeyNotFound
- `user.ts`: User, Appearance, DEFAULT_APPEARANCE, Profile, NewUser, newUserProblems, profileProblems, passwordProblems, keptEmail, sameEmail, userOf, addedUserOf, withPassword, withOneTimePassword, isWaitingForFirstSignIn, isOneTimePasswordExpired, withProfile, withAppearance, removalProblems, removed
- `wrong-tries.ts`: WrongTries, NO_WRONG_TRIES, tryRefusal, afterWrongTry, wrongTryAnswer
- Tests: relying-party.test.ts

### ports/

- `authenticator-repository.ts`: AuthenticatorRepository
- `passkey-ceremonies.ts`: CeremonyStart, CeremonyAnswer, PasskeyCeremonies
- `passkey-repository.ts`: PasskeyRepository
- `password-hashing.ts`: PasswordHashing
- `pending-ceremonies.ts`: PendingCeremonies
- `pending-sign-in-repository.ts`: PendingSignInRepository
- `second-steps.ts`: SecondStep, SecondSteps
- `signed-in-device-repository.ts`: SignedInDeviceRepository
- `user-repository.ts`: UserRepository

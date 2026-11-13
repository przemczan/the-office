# Users: module map

**Owns:** users and signing in (spec §2.10): `users` (name, email kept as typed and unique ignoring case among users not removed, a scrypt password hash `scrypt$N$r$p$salt$key` from `ScryptPasswordHashing`, `one_time_password_expires_at` set while that hash is a one-time password's, the wrong tries: how many in a row, the next try allowed at, locked until; `palette` and `density`, null for Follow the system and Comfortable; `removed_at`) and `signed_in_devices` (one row per browser signed in: the SHA-256 of its token only, its user agent and address kind, signed in, last seen and expires, 30 days after the last use, both written at most once a minute). The first user (`FirstUser`, `POST /sign-in/first-user`) is made only while no user was ever made, removed ones counted, in one transaction, so two at once make one. `Users` (Settings › Users, `/users`) lists the users not removed, adds one with a one-time password (`domain/one-time-password.ts`: 16 characters without look-alikes, shown grouped by four, hashed as typed without dashes in capitals, answered once and kept nowhere; it works 7 days, and a waiting user's can be made anew, which ends the old), and removes one: `removeAmongActive` locks every user not removed in id order and refuses yourself and a remover removed meanwhile, so two users removing each other leave one; the row stays, its password hash cleared, so `namesOf` still reads the name, its email free again; then `SignedInDevices.signOutAll`. `PasswordChecks` checks any password, a one-time one included: it counts a try wrong before checking and clears the count once it matches; `domain/wrong-tries.ts` holds the Defaults (3 free tries, then waits of 2, 4, 8 and 16 s answered as 429 with when to try again, never slept on; the 10th in a row locks for 15 minutes, doubling up to a day). An unknown or removed user's email gets the same answers, hashed against a dummy (`UnknownEmailTries`, in memory). `PasswordSignIn` signs in with it; a right one-time password answers `set-password` and makes no device (`expired` past its days), and `FirstPassword` (`POST /sign-in/set-password`) takes it again with the user's own, under the same checks, and ends in `SignIns.finish`. `Accounts` answers `/account`: the profile, a password change (the current one under the same checks, answered "The current password is wrong."; it signs out every other device) and the appearance. `SignedInDevices` lists, checks and signs out devices; a removed user's devices sign in nothing (`findByTokenHash` joins the user). `Passwords` sets a password (the host's `npm run set-password`, `src/set-password.ts`), lifting the lockout and the one-time password and signing out every device. The cookie (`adapters/http/sign-in-cookie.ts`, `office_signed_in`) is `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` only when the request came through the public address over https.

**The authenticator** (spec §2.10 Defaults): `authenticators` (one per user: the TOTP secret in base32, readable since codes are checked against it, confirmed at, the last time step whose code was taken) and `recovery_codes` (SHA-256 of the normalised code only, used at), kept together by `AuthenticatorRepository`. `Authenticators` sets one up (`POST /account/authenticator`: a new secret in place of any unconfirmed one, its `otpauth://` address and key sent only then), turns it on with a first code (`/confirm`, answering 10 recovery codes once, `XXXXX-XXXXX` from `domain/recovery-code.ts`'s alphabet without look-alikes), turns it off (`DELETE`, with a code or a recovery code) and makes new recovery codes (`POST /account/recovery-codes`, with a code); `npm run set-password -- --clear-authenticator` removes it with its recovery codes through `Authenticators.remove`, the new password having lifted the lockout; `GET /account` says `off` or `on` with the recovery codes left. `domain/authenticator.ts` checks a code at the `Schedule`'s time, one step either side, never a step at or before the last taken (`takeStep` is a conditional UPDATE, so two requests can't both take one). `AuthenticatorCodes` checks a code or a recovery code for every use, counted by `UserWrongTries` on the user's one count of wrong tries (spec: "the user's password and codes are locked"), cleared by a right code; `PasswordChecks` counts passwords (signing in, the first password, Change password) on the same count, and a right password undoes only its own try (`UserWrongTries.undo`), so it never resets wrong codes before it.

**The code step:** `SecondSteps` is bound to `AuthenticatorSecondStep`: after a way not `enoughAlone` (a `SignInWay` flag; the passkey's Task sets it true), a user whose authenticator is on gets a pending sign-in (`pending_sign_ins`: the SHA-256 of its token, 5 minutes) instead of a signed-in device, and the outcome `code-needed`; a right one-time password answers `set-password` before any of this, and the first password then ends in `SignIns.finish` too. `adapters/http/sign-in-answers.ts` writes every way's answer: `answerSignIn` in the body, `redirectSignIn` for a callback (to `/sign-in/code?returnTo=…` when the code is needed); the pending token travels only in `office_pending_sign_in` (`HttpOnly`, `SameSite=Lax`, `Path=/api/sign-in`, `Max-Age=300`). `POST /sign-in/code` (`CodeSignIn`) checks the code, uses the pending sign-in up and signs the device in through `SignIns.signIn`, which clears the wrong tries; an ended pending sign-in answers 401.

**Extension points:** `SignIns.finish(user, way, request)` is where every way of signing in ends, given the `SignInWay` itself: unless the way is `enoughAlone`, it asks the `SecondSteps` port, then makes the signed-in device; a later way answers its callback with `redirectSignIn`. `SignInWays` is the registry of ways (`SignInWay`: its kind, the address kinds it works at, whether it is available); a way's module `add`s itself, and `GET /sign-in` lists those for the request's address kind. Contracts' `SignInWay` and the sign-in answer's `outcome` are discriminated unions (`password`; `signed-in`, `code-needed` and `set-password`), as is the web's way-kind map (`surfaces/sign-in/sign-in-ways.tsx`). Every later way's callback lives under `/api/sign-in/`, the only path open without a signed-in device.

**Talks to:** the platform's `SignedInRequests` port, bound in `app.module.ts` to `CookieSignedInRequests` through `RequestAccessModule`, which the platform's guard and event stream ask who a request's device is, and whose `onSignedOut` (the `SignedOut` event) closes that device's WebSockets at once, and `signedOutAmong` each minute those of devices signed out by the recovery command's own process or expired; the platform's `OfficeAddresses` for the address kind (`adapters/http/sign-in-request.ts` maps it to the domain's own copy); the `Schedule` for the time. Publishes `UserCreated`, `UserChanged`, `UserRemoved`, `SignedIn`, `SignedOut`, `PasswordSet`, `AuthenticatorSetUp`, `AuthenticatorRemoved`, `RecoveryCodesMade`, `RecoveryCodeUsed`, none carrying a secret, token or code; `adapters/websocket/user-web-events.ts` forwards the first three to the web. A later Task's own tables of a user's (linked identities, passkeys) clean up on `UserRemoved`, since the user's row stays and nothing cascades; `Users.remove` itself ends the user's pending sign-ins and removes their authenticator and recovery codes.

**Traps:** a signed-in device is never called a session, in code, API or database. `UserRepository.find` answers removed users too (for the records); everything that signs in or lists goes through `findByEmail`, `listActive` or a check of `removedAt`. `set-password.ts` boots the module without the event stream, so it provides its own `WebEventForwarding`. The domain keeps its own `AddressKind`, since the boundary lint allows it nothing from the platform but `DomainEvent`. Unknown emails' wrong tries are in memory and start again at a restart; a user's are in the database and don't. Other modules' tests boot unguarded (`startTestApplication` binds `EveryoneSignedIn`); a test that needs the guard uses `startUsersApplication` and `signedInCookie` from `index.fixtures.ts`, and `turnOnAuthenticator` and `authenticatorCodeOf` for a user with an authenticator; a code of the confirming step is taken already, so the next sign-in uses the next step's code (`ManualSchedule.advanceBy` 30 s, or one step of drift). The fixtures' `send` gives a body's Content-Length, without which Node sends no DELETE body. A pending sign-in is never called a session.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

CookieSignedInRequests, answerSignIn, redirectSignIn, Accounts, Authenticators, Passwords, SignInWays, SignIns, SignInOutcome, SignedInOutcome, SignedInDevices, Users, AddressKind, SignInRequest, SignInWay, SignInWayKind, AuthenticatorRemoved, AuthenticatorSetUp, PasswordSet, RecoveryCodeUsed, RecoveryCodesMade, SignedIn, SignedOut, UserChanged, UserCreated, UserRemoved, UserNotFound, UserRefused, UsersModule

## Domain events

- `domain/user-events.ts`: UserCreated, UserChanged, UserRemoved, SignedIn, SignedOut, PasswordSet, AuthenticatorSetUp, AuthenticatorRemoved, RecoveryCodesMade, RecoveryCodeUsed

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

- `adapters/postgres/users.schema.ts`: users, signed_in_devices, authenticators, recovery_codes, pending_sign_ins

## Files

### ./

- `index.fixtures.ts`: A_PASSWORD, UserForTests, addUser, signedInCookie, authenticatorCodeOf, turnOnAuthenticator, send, setCookieOf, startUsersApplication, UsersApplication
- `users-application.fixtures.ts`: PUBLIC_ADDRESS, UsersApplication, UsersApplicationOptions, startUsersApplication, Sent, Answer, send, setCookieOf
- `users.module.ts`: UsersModule

### adapters/crypto/

- `scrypt-password-hashing.ts`: ScryptPasswordHashing
- Tests: scrypt-password-hashing.test.ts

### adapters/http/

- `account.controller.ts`: AccountController
- `cookie-signed-in-requests.ts`: CookieSignedInRequests
- `sign-in-answers.ts`: answerSignIn, redirectSignIn
- `sign-in-cookie.ts`: SIGN_IN_COOKIE, PENDING_SIGN_IN_COOKIE, signInCookie, clearedSignInCookie, pendingSignInCookie, clearedPendingSignInCookie, signInTokenOf, pendingSignInTokenOf
- `sign-in-request.ts`: addressKindOf, signInRequestOf
- `sign-in.controller.ts`: SignInController
- `user-refusals.filter.ts`: UserRefusalsFilter
- `users.controller.ts`: UsersController
- Tests: account.controller.test.ts, authenticator.test.ts, sign-in-answers.test.ts, sign-in.controller.test.ts, users.controller.test.ts

### adapters/postgres/

- `postgres-authenticator-repository.ts`: PostgresAuthenticatorRepository
- `postgres-pending-sign-in-repository.ts`: PostgresPendingSignInRepository
- `postgres-signed-in-device-repository.ts`: PostgresSignedInDeviceRepository
- `postgres-user-repository.ts`: PostgresUserRepository
- `users.schema.ts`: users, signedInDevices, authenticators, recoveryCodes, pendingSignIns

### adapters/second-steps/

- `authenticator-second-step.ts`: AuthenticatorSecondStep

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
- `password-checks.ts`: PasswordChecks
- `password-sign-in.ts`: PasswordSignIn
- `passwords.ts`: Passwords
- `pending-sign-ins.ts`: PendingSignIns
- `recovery-code-secrets.ts`: newRecoveryCodes, recoveryCodeHashOf
- `sign-in-tokens.ts`: newSignInToken, tokenHashOf
- `sign-in-ways.ts`: SignInWays
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
- `pending-sign-in.ts`: PendingSignIn, PENDING_SIGN_IN_SECONDS, pendingSignInOf, isPending
- `recovery-code.ts`: RECOVERY_CODE_COUNT, RECOVERY_CODE_ALPHABET, RECOVERY_CODE_LENGTH, shownRecoveryCode, normalisedRecoveryCode
- `sign-in-refused.ts`: SignInRefusal, TriedWith, SignInRefused
- `sign-in-way.ts`: SignInWayKind, SignInWay, PASSWORD_WAY
- `signed-in-device.ts`: SignedInDevice, SignInRequest, signedInDeviceOf, isSignedIn, seenAt
- `user-events.ts`: UserCreated, UserChanged, UserRemoved, SignedIn, SignedOut, PasswordSet, AuthenticatorSetUp, AuthenticatorRemoved, RecoveryCodesMade, RecoveryCodeUsed
- `user-refused.ts`: UserRefused, FirstUserExists, UserNotFound, PendingSignInEnded, UserIdNotFound, SignedInDeviceNotFound
- `user.ts`: User, Appearance, DEFAULT_APPEARANCE, Profile, NewUser, newUserProblems, profileProblems, passwordProblems, keptEmail, sameEmail, userOf, addedUserOf, withPassword, withOneTimePassword, isWaitingForFirstSignIn, isOneTimePasswordExpired, withProfile, withAppearance, removalProblems, removed
- `wrong-tries.ts`: WrongTries, NO_WRONG_TRIES, tryRefusal, afterWrongTry, wrongTryAnswer

### ports/

- `authenticator-repository.ts`: AuthenticatorRepository
- `password-hashing.ts`: PasswordHashing
- `pending-sign-in-repository.ts`: PendingSignInRepository
- `second-steps.ts`: SecondStep, SecondSteps
- `signed-in-device-repository.ts`: SignedInDeviceRepository
- `user-repository.ts`: UserRepository

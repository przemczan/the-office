# Users: module map

**Owns:** users and signing in (spec §2.10): `users` (name, email kept as typed and unique ignoring case among users not removed, a scrypt password hash `scrypt$N$r$p$salt$key` from `ScryptPasswordHashing`, `one_time_password_expires_at` set while that hash is a one-time password's, the wrong tries: how many in a row, the next try allowed at, locked until; `palette` and `density`, null for Follow the system and Comfortable; `removed_at`) and `signed_in_devices` (one row per browser signed in: the SHA-256 of its token only, its user agent and address kind, signed in, last seen and expires, 30 days after the last use, both written at most once a minute). The first user (`FirstUser`, `POST /sign-in/first-user`) is made only while no user was ever made, removed ones counted, in one transaction, so two at once make one. `Users` (Settings › Users, `/users`) lists the users not removed, adds one with a one-time password (`domain/one-time-password.ts`: 16 characters without look-alikes, shown grouped by four, hashed as typed without dashes in capitals, answered once and kept nowhere; it works 7 days, and a waiting user's can be made anew, which ends the old), and removes one: `removeAmongActive` locks every user not removed in id order and refuses yourself and a remover removed meanwhile, so two users removing each other leave one; the row stays, its password hash cleared, so `namesOf` still reads the name, its email free again; then `SignedInDevices.signOutAll`. `PasswordChecks` checks any password, a one-time one included: it counts a try wrong before checking and clears the count once it matches; `domain/wrong-tries.ts` holds the Defaults (3 free tries, then waits of 2, 4, 8 and 16 s answered as 429 with when to try again, never slept on; the 10th in a row locks for 15 minutes, doubling up to a day). An unknown or removed user's email gets the same answers, hashed against a dummy (`UnknownEmailTries`, in memory). `PasswordSignIn` signs in with it; a right one-time password answers `set-password` and makes no device (`expired` past its days), and `FirstPassword` (`POST /sign-in/set-password`) takes it again with the user's own, under the same checks, and ends in `SignIns.finish`. `Accounts` answers `/account`: the profile, a password change (the current one under the same checks, answered "The current password is wrong."; it signs out every other device) and the appearance. `SignedInDevices` lists, checks and signs out devices; a removed user's devices sign in nothing (`findByTokenHash` joins the user). `Passwords` sets a password (the host's `npm run set-password`, `src/set-password.ts`), lifting the lockout and the one-time password and signing out every device. The cookie (`adapters/http/sign-in-cookie.ts`, `office_signed_in`) is `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` only when the request came through the public address over https.

**Extension points:** `SignIns.finish(user, way, request)` is where every way of signing in ends: it asks the `SecondSteps` port (bound to `NoSecondSteps`; the authenticator Task binds its own) and makes the signed-in device. `SignInWays` is the registry of ways (`SignInWay`: its kind, the address kinds it works at, whether it is available); a way's module `add`s itself, and `GET /sign-in` lists those for the request's address kind. Contracts' `SignInWay` and the sign-in answer's `outcome` are discriminated unions (only `password`, and `signed-in` and `set-password`, now), as is the web's way-kind map (`surfaces/sign-in/sign-in-ways.tsx`). Every later way's callback lives under `/api/sign-in/`, the only path open without a signed-in device.

**Talks to:** the platform's `SignedInRequests` port, bound in `app.module.ts` to `CookieSignedInRequests` through `RequestAccessModule`, which the platform's guard and event stream ask who a request's device is, and whose `onSignedOut` (the `SignedOut` event) closes that device's WebSockets at once, and `signedOutAmong` each minute those of devices signed out by the recovery command's own process or expired; the platform's `OfficeAddresses` for the address kind (`adapters/http/sign-in-request.ts` maps it to the domain's own copy); the `Schedule` for the time. Publishes `UserCreated`, `UserChanged`, `UserRemoved`, `SignedIn`, `SignedOut`, `PasswordSet`; `adapters/websocket/user-web-events.ts` forwards the first three to the web. A later Task's own tables of a user's (linked identities, passkeys, the authenticator and recovery codes) clean up on `UserRemoved`, since the user's row stays and nothing cascades.

**Traps:** a signed-in device is never called a session, in code, API or database. `UserRepository.find` answers removed users too (for the records); everything that signs in or lists goes through `findByEmail`, `listActive` or a check of `removedAt`. `set-password.ts` boots the module without the event stream, so it provides its own `WebEventForwarding`. The domain keeps its own `AddressKind`, since the boundary lint allows it nothing from the platform but `DomainEvent`. Unknown emails' wrong tries are in memory and start again at a restart; a user's are in the database and don't. Other modules' tests boot unguarded (`startTestApplication` binds `EveryoneSignedIn`); a test that needs the guard uses `startUsersApplication` and `signedInCookie` from `index.fixtures.ts`.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

CookieSignedInRequests, Accounts, Passwords, SignInWays, SignIns, SignInOutcome, SignedInDevices, Users, AddressKind, SignInRequest, SignInWay, SignInWayKind, PasswordSet, SignedIn, SignedOut, UserChanged, UserCreated, UserRemoved, UserNotFound, UserRefused, UsersModule

## Domain events

- `domain/user-events.ts`: UserCreated, UserChanged, UserRemoved, SignedIn, SignedOut, PasswordSet

## HTTP routes (under `/api`)

- `POST /sign-out`: AccountController.signOut
- `GET /account`: AccountController.account
- `PATCH /account`: AccountController.changeProfile
- `POST /account/password`: AccountController.changePassword
- `PUT /account/appearance`: AccountController.setAppearance
- `GET /account/signed-in-devices`: AccountController.signedInDeviceList
- `DELETE /account/signed-in-devices/:id`: AccountController.signOutDevice
- `GET /sign-in`: SignInController.page
- `POST /sign-in/first-user`: SignInController.createFirstUser
- `POST /sign-in/password`: SignInController.withPassword
- `POST /sign-in/set-password`: SignInController.setPassword
- `GET /users`: UsersController.list
- `POST /users`: UsersController.add
- `POST /users/:userId/one-time-password`: UsersController.newOneTimePassword
- `DELETE /users/:userId`: UsersController.remove

## Tables

- `adapters/postgres/users.schema.ts`: users, signed_in_devices

## Files

### ./

- `index.fixtures.ts`: A_PASSWORD, UserForTests, addUser, signedInCookie, send, setCookieOf, startUsersApplication, UsersApplication
- `users-application.fixtures.ts`: PUBLIC_ADDRESS, UsersApplication, UsersApplicationOptions, startUsersApplication, Sent, Answer, send, setCookieOf
- `users.module.ts`: UsersModule

### adapters/crypto/

- `scrypt-password-hashing.ts`: ScryptPasswordHashing
- Tests: scrypt-password-hashing.test.ts

### adapters/http/

- `account.controller.ts`: AccountController
- `cookie-signed-in-requests.ts`: CookieSignedInRequests
- `sign-in-cookie.ts`: SIGN_IN_COOKIE, signInCookie, clearedSignInCookie, signInTokenOf
- `sign-in-request.ts`: addressKindOf, signInRequestOf
- `sign-in.controller.ts`: SignInController
- `user-refusals.filter.ts`: UserRefusalsFilter
- `users.controller.ts`: UsersController
- Tests: account.controller.test.ts, sign-in.controller.test.ts, users.controller.test.ts

### adapters/postgres/

- `postgres-signed-in-device-repository.ts`: PostgresSignedInDeviceRepository
- `postgres-user-repository.ts`: PostgresUserRepository
- `users.schema.ts`: users, signedInDevices

### adapters/second-steps/

- `no-second-steps.ts`: NoSecondSteps

### adapters/websocket/

- `user-web-events.ts`: UserWebEvents

### application/

- `accounts.ts`: PasswordChange, Accounts
- `first-password.ts`: FirstPasswordRequest, FirstPassword
- `first-user.ts`: FirstUser
- `one-time-passwords.ts`: newOneTimePassword
- `password-checks.ts`: PasswordChecks
- `password-sign-in.ts`: PasswordSignIn
- `passwords.ts`: Passwords
- `sign-in-tokens.ts`: newSignInToken, tokenHashOf
- `sign-in-ways.ts`: SignInWays
- `sign-ins.ts`: SignedInOutcome, SignInOutcome, SignIns
- `signed-in-devices.ts`: NewSignedInDevice, SignedInDevices
- `unknown-email-tries.ts`: UnknownEmailTries
- `users.ts`: AddedUser, Users
- Tests: password-sign-in.test.ts, sign-ins.test.ts

### domain/

- `address-kind.ts`: AddressKind, ADDRESS_KINDS
- `one-time-password.ts`: ONE_TIME_PASSWORD_ALPHABET, ONE_TIME_PASSWORD_LENGTH, groupedOneTimePassword, oneTimePasswordAsTyped
- `sign-in-refused.ts`: SignInRefusal, SignInRefused
- `sign-in-way.ts`: SignInWayKind, SignInWay, PASSWORD_WAY
- `signed-in-device.ts`: SignedInDevice, SignInRequest, signedInDeviceOf, isSignedIn, seenAt
- `user-events.ts`: UserCreated, UserChanged, UserRemoved, SignedIn, SignedOut, PasswordSet
- `user-refused.ts`: UserRefused, FirstUserExists, UserNotFound, UserIdNotFound, SignedInDeviceNotFound
- `user.ts`: User, Appearance, DEFAULT_APPEARANCE, Profile, NewUser, newUserProblems, profileProblems, passwordProblems, keptEmail, sameEmail, userOf, addedUserOf, withPassword, withOneTimePassword, isWaitingForFirstSignIn, isOneTimePasswordExpired, withProfile, withAppearance, removalProblems, removed
- `wrong-tries.ts`: WrongTries, NO_WRONG_TRIES, tryRefusal, afterWrongTry, wrongTryAnswer

### ports/

- `password-hashing.ts`: PasswordHashing
- `second-steps.ts`: SecondStep, SecondSteps
- `signed-in-device-repository.ts`: SignedInDeviceRepository
- `user-repository.ts`: UserRepository

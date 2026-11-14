# 55 · Users and signing in

Status: in progress

Run in The Office itself as the Initiative `4ac75ab6-5d0d-42dd-a832-03cd99d37d80`: each step below is one of its Tasks, which carries the step's plan.

## Goal

The Office has several users, and everyone signs in before using it, localhost included ([spec 2.10](../spec/2.10-users-and-signing-in.md)). The first user is created at first run; any user adds an account for someone else with a one-time password and can remove one. A user signs in with a password, Continue with GitHub, Continue with Google or a passkey, then an authenticator code once they have set one up, a passkey being enough alone; the sign-in page shows only the ways that work on the address it was opened at (`localhost`, an IP on the local network over plain HTTP, or the public address behind the user's reverse proxy, [spec 5.1](../spec/5.1-shape.md)). Every request and WebSocket needs a signed-in device but the sign-in pages and their callbacks; wrong passwords and codes slow down and lock out; passwords, sign-in tokens and recovery codes are stored only as hashes ([spec 6](../spec/6-permissions-and-safety.md)); each user sees their signed-in devices and signs any out; recovery codes and `npm run set-password` get a user back in. Records name the user who did each thing and an Agent's Brief says which user asked; palette and density are per user; everything else stays shared.

## Definition of Done

- [x] The spec and the glossary describe users and signing in, spec 5.1's no-sign-in rule is replaced and task 28's PIN is dropped. Check: Task 3afd3982's Gate.
- [x] The first user is created at first run; a user signs in with a password and stays signed in with a cookie whose token is stored hashed per signed-in device; every `/api` request and WebSocket, from localhost too, needs a signed-in device except the sign-in pages, their callbacks, `/api/health` and the `-p` hook; the Host and Origin checks accept the public address; wrong passwords slow down and lock out; a user signs out any of their signed-in devices; `npm run set-password` sets a new password. Check: Task 54467d4a's service tests (the whole-app guard test among them) and `sign-in.e2e.ts`.
- [x] A user adds an account for someone else with a one-time password shown once, the new user sets their own password at first sign-in, removing a user signs out all their devices, and palette and density are per user. Check: Task 4807a232's service and e2e tests.
- [x] Records name the user who did each thing (an Idea, Task or Initiative created, a Task started or moved, a Decision answered, a message written in a Thread, a setting changed), an Agent's Brief says which user asked, and Since you left begins at each user's own absence. Check: Task 2727e7bb's service, web and e2e tests.
- [x] A user sets up an authenticator, is asked for a code after a password, Continue with GitHub or Continue with Google, and signs in with a recovery code instead; wrong codes count toward the lockout. Check: Task 1b3bfd22's service tests on a manual clock and its e2e test.
- [x] A user adds passkeys from their account and signs in with one alone, at `localhost` and the public address only. Check: Task 98340c1d's service tests and an e2e test with a virtual authenticator.
- [x] A user links their GitHub identity and signs in with Continue with GitHub, only a linked identity signing in and Sign in with GitHub left untouched. Check: Task f69f7428's service tests against the fake GitHub and its e2e test.
- [x] A user links their Google identity and signs in with Continue with Google, at `localhost` and the public address only. Check: Task a4316406's service tests against a fake Google.
- [ ] `npm run verify` passes at every step. Check: each Task's run.

## Read first

- [Spec 2.10](../spec/2.10-users-and-signing-in.md), with its Defaults; [spec 5.1](../spec/5.1-shape.md) and [spec 6](../spec/6-permissions-and-safety.md)'s threat model for signing in.
- The glossary's [Users and signing in](../../GLOSSARY.md#users-and-signing-in) terms, and Sign in with GitHub, which Continue with GitHub must never touch.
- The users module's map, once step 2 has made it; the map of each module or surface a step changes.

## Leave out

- Who may do what: permissions per user, roles of users, an administrator. Every user can do everything.
- Anything per user beyond the account, the palette, the density and where Since you left begins: people, Projects, Pipelines, Memory, Office instructions, Notifications, Needs you and Decisions stay shared, and so does the Office identity.
- Signing in by email link, other identity providers, single sign-on, and email of any kind (the one-time password is passed on by hand).
- Setting up the reverse proxy, which is the user's; [docs/running-the-office.md](../running-the-office.md) says what The Office needs from it.
- The phone's own work (task 28).

## Steps

- [x] 1. The spec and the glossary for users and signing in, and this file (Task 3afd3982).
- [x] 2. Users and signing in with a password: the `users` module, the first user, the password, signed-in devices and Sign out, the guard, the public address, slow-down and lockout, the recovery command (Task 54467d4a).
      Read: [module template](../../apps/service/docs/module-template.md); the platform map (`http/local-requests.ts`, `websocket/event-stream.ts`, `config/office-config.ts`); `apps/web/src/MAP.md`; `apps/web/e2e/MAP.md`.
- [x] 3. Creating and removing users: Settings › Users, the one-time password, setting one's own password at first sign-in, removing a user, the account page, palette and density per user (Task 4807a232).
      Read: the users map; the settings and account surfaces' maps; `packages/ui/src/appearance/`.
- [x] 4. Records name the user who did each thing, the Brief says which user asked, Since you left per user (Task 2727e7bb).
      Read: the work, conversations and notifications maps.
- [x] 5. Authenticator codes and recovery codes, with `@oslojs/otp` (Task 1b3bfd22).
      Read: the users map (`SecondSteps`, `SignIns.finish`).
- [x] 6. Passkeys, with `@simplewebauthn/server` and `@simplewebauthn/browser` (Task 98340c1d).
      Read: the users map (`SignInWays`); the sign-in and account surfaces' maps.
- [x] 7. Continue with GitHub, through the GitHub module's App, and linked identities (Task f69f7428).
      Read: the github and users maps.
- [x] 8. Continue with Google, with `arctic`, reusing linked identities (Task a4316406).
      Read: the users map (`IdentityProvider`, linked identities).

## State

- Steps 1 to 8 written. Step 2: the `users` module (its map names the extension points: `SignIns.finish`, the `SecondSteps` port, the `SignInWays` registry); the platform's Host/Origin check with `OFFICE_PUBLIC_ADDRESS`, the sign-in guard (`platform/http/request-access.ts`, port `SignedInRequests`), the event stream closing a signed-out device's sockets; `npm run set-password`; e2e's `setup` project signs in once.
- Step 3: `Users` (Settings › Users, `/users`): add with a one-time password (16 characters, grouped, 7 days, made anew from the row), remove (the row stays with `removed_at`, its hash cleared, `namesOf` reads it; `removeAmongActive` locks the active users so two removals leave one; yourself refused); `PasswordChecks` shared by sign-in, `FirstPassword` (`POST /sign-in/set-password`), the account's password change and adding a passkey; `Accounts`: `PATCH /account`, `POST /account/password` (signs out the other devices), `PUT /account/appearance`. Events `UserChanged`, `UserRemoved`; web events `user.*`. Web: `surfaces/settings/users/`, the first-password form, the account as sections (Profile, Authenticator, Appearance, Passkeys, Signed-in devices), `shell/account-appearance.tsx`. e2e: `own-user.ts` (`asOwnUser`), `users.e2e.ts`.
- Step 5: `authenticators`, `recovery_codes`, `pending_sign_ins` (migration 0139); `SecondSteps` bound to `AuthenticatorSecondStep`; `SignIns.finish(user, way: SignInWay, request)` skips the code for a way `enoughAlone`; every way's answer goes through `adapters/http/sign-in-answers.ts` (`answerSignIn`, with other cookies such as the passkey ceremony's; `redirectSignIn` for a callback, sending a `code-needed` sign-in to `/sign-in/code?returnTo=…`); `npm run set-password -- --clear-authenticator`; the web's code page and Account › Authenticator.
- Step 6 (passkeys): `@simplewebauthn/server` 14.1.0 and `@simplewebauthn/browser` 14.0.0, pinned exactly. The relying party is the page's own address (`domain/relying-party.ts`): `localhost`, or the public address's name over HTTPS; elsewhere `GET /sign-in`'s `unavailable` gives the reason and a link. `PASSKEY_WAY` is `enoughAlone` and `PasskeySignIn` ends in `SignIns.finish(user, PASSKEY_WAY)`, so a passkey skips the code. Table `passkeys` (migration 0138); `Passkeys` (`/account/passkeys`, adding after the current password, tied to the signed-in device) and `PasskeySignIn` (`/sign-in/passkey`, a ceremony cookie, one refusal for every failure, not stopped by the lockout); pending ceremonies in memory, capped at 1000, 5 minutes. Web: `surfaces/sign-in/passkey-way.tsx`, `surfaces/account/passkeys-section.tsx`; e2e `passkeys.e2e.ts` with a CDP virtual authenticator.
- Step 7 (Continue with GitHub): the github module's `GitHubIdentities` (no scope, PKCE, `GET /user`, the token revoked by `DELETE /applications/{client_id}/token`, never touching `github_sign_in`); the manifest lists `/api/sign-in/github/callback` here and at the public address after Sign in with GitHub's callback. The users module's generic `IdentityProvider` port (`UsersModule.register({ imports, identityProviders })`, `GitHubIdentityProvider`), `linked_identities` (migration 0145) keyed by (provider, subject), `IdentityTrips` in memory, `LinkedIdentities` (`/account/linked-identities`), `IdentitySignIns` (`/sign-in/github`, one callback for signing in and linking, ending in `SignIns.finish` with a way not enough alone and `redirectSignIn`). Web: `surfaces/sign-in/github-way.tsx`, `surfaces/account/linked-identities-section.tsx`, Continue with GitHub's setup on Settings › Office identity's GitHub card; e2e in `office-identity.e2e.ts`. The App stays private; Settings says to make it public for others.
- Decided against the Plan, by spec 2.10's Defaults: a one-time password expires after 7 days (`one_time_password_expires_at`, set = waiting for first sign-in); a right but expired one answers the refusal `expired`.
- Defaults as spec 2.10 proposes them: 3 free wrong tries, waits of 2/4/8/16 s, lockout from the 10th for 15 min doubling to 24 h; 30 days after the last use; passwords 12 to 256 characters; cookie `office_signed_in`; 10 recovery codes `XXXXX-XXXXX`; TOTP SHA-1, 6 digits, 30 s, one step of drift; a pending sign-in waits 5 minutes (cookie `office_pending_sign_in`, `Path=/api/sign-in`).
- Wrong passwords (every `PasswordChecks` use) and codes share the user's one count (spec: "the user's password and codes are locked"); a right password undoes only its own try, a right code or a signed-in device clears it.
- Step 8 (Continue with Google): `arctic` 3.7.0, pinned, only in `adapters/google/google-identity-provider.ts` (`openid email`, PKCE S256, no offline access; the ID token's `iss`, `aud` and `exp` checked, not its signature; `sub` the identity, the email its display name). The Google OAuth client is `google_client` (migration 0146, one row, the secret as entered and never answered), `GoogleClients` and Settings › Signing in (`/settings/google-client`, `surfaces/settings/signing-in/`). Starting any provider now goes through `IdentityProviders.startingAt`, so Google at an IP address is refused with where it works; the linked identity list has `unavailableHere`, and `identityCallbackUrlsSchema.thisAddress` is null there. Web: `google-way.tsx`, the Google row on the account, `shell/google-mark.tsx` (Lucide has no Google icon). e2e: `signing-in.e2e.ts` catches Google's authorize page. Only `postgres-google-client-repository.test.ts` writes `google_client`; other tests bind `googleClientForTests()`.
- Traps: other modules' service tests boot unguarded (`startTestApplication`'s `requestAccess`). Every e2e file shares the one e2e user (`e2e/e2e-user.ts`): no test may lock it out or turn its authenticator on, and a test choosing a palette or density, or setting up an authenticator, runs as its own user (`asOwnUser`). Unknown emails' wrong tries are in memory. "Sign in with GitHub" is The Office's git identity, never a user's way. A signed-in device and a pending sign-in are never a session.
- Step 4 written: records keep the signed-in user as a snapshot `{ userId, name }` (contracts `userRefSchema`); each module's domain has its own user shape, and controllers map `@SignedIn()` onto it. Records from before users existed hold null ("the user") until the first user claims them: each module registers an idempotent claim with the platform's `EarlierRecords` (`platform/earlier-records/`), and `users` runs them after the first user is made, then again at each start until they finish (`earlier_records_claimed` flag). Migrations 0140–0144.
- Briefs have a "## Who asked" section (`work/domain/who-asked.ts`, through Pipelines' `TaskRecords`). Since you left is per user (`user_activity` keyed by user id, `GET /now/since-you-left`); the phone counts The Office away only when every user is away. The web words a user ref "You"/the name through `shell/use-user-name.ts`.
- Traps: an Agent's own record (an Agent's `remember`, `change_role`, an engine removal's card version) names no user; the claims only fill JSON nulls the migrations wrote, never SQL nulls. Unguarded test apps sign in the fixed test user of `signed-in-requests.fixtures.ts`.
- Next: closing the task once its remaining boxes are checked. Owed on real Google: a sign-in end to end (docs/running-the-office.md). Owed on real GitHub: a plain-HTTP callback on a LAN IP, exact ports on loopback, the refresh token ending with the revoked token (docs/running-the-office.md).

## Progress

- 2026-11-13 · step 1: spec 2.10, the amendments, the glossary terms, task 28 without a PIN, and this file; next is step 2, Task 54467d4a.
- 2026-11-13 · step 2: the users module, the guard on /api and the WebSocket, the public address, slow-down and lockout, signed-in devices, npm run set-password, the sign-in and Account pages and e2e signed in through a setup project; next is step 3, Task 4807a232.
- 2026-11-13 · step 5: authenticator codes and recovery codes, the pending sign-in and the code page, wrong codes on the password's count, `--clear-authenticator`, the account's Authenticator section and `authenticator.e2e.ts`; next is step 3, Task 4807a232.
- 2026-11-13 · step 3: Settings › Users with one-time passwords, setting one's own password at first sign-in, removing users, the account as Profile, Appearance and Signed-in devices, palette and density per user; next is step 4, Task 2727e7bb.
- 2026-11-13 · step 6: passkeys: the relying party per address, `unavailable` ways on the sign-in page, adding, renaming and removing on the account, signing in alone with a passkey, `docs/running-the-office.md`; next is step 4, Task 2727e7bb.
- 2026-11-13 · step 4: records name the signed-in user in Work, Conversations, People, Skills and Pipelines, earlier records claimed by the first user, Briefs say who asked, the web shows You or the name, Since you left per user; next is step 7, Task f69f7428.
- 2026-11-13 · step 7: Continue with GitHub through the registered GitHub App, linked identities on the account, the callback URLs on Settings › Office identity, the token revoked at once and Sign in with GitHub untouched; merged after step 4, its callback now sending a user with an authenticator to the code page; next is step 8, Task a4316406.
- 2026-11-14 · step 8: Continue with Google through `arctic`, the Google OAuth client in Settings › Signing in with its redirect URIs and steps, the Google row on the account, refused at an IP address, `signing-in.e2e.ts`; next is closing the task.
- 2026-11-14 · review: a Gate action keeps the user who took it and the Stage history names them; migration 0144 claims only Role card versions a user saved or applied, not a person's own rewording; next is closing the task.

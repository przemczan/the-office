import { Module } from "@nestjs/common";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { ScryptPasswordHashing } from "./adapters/crypto/scrypt-password-hashing.js";
import { AccountController } from "./adapters/http/account.controller.js";
import { CookieSignedInRequests } from "./adapters/http/cookie-signed-in-requests.js";
import { PasskeySignInController } from "./adapters/http/passkey-sign-in.controller.js";
import { PasskeysController } from "./adapters/http/passkeys.controller.js";
import { SignInController } from "./adapters/http/sign-in.controller.js";
import { UsersController } from "./adapters/http/users.controller.js";
import { InMemoryPendingCeremonies } from "./adapters/in-memory/in-memory-pending-ceremonies.js";
import { PostgresPasskeyRepository } from "./adapters/postgres/postgres-passkey-repository.js";
import { PostgresSignedInDeviceRepository } from "./adapters/postgres/postgres-signed-in-device-repository.js";
import { PostgresUserRepository } from "./adapters/postgres/postgres-user-repository.js";
import { NoSecondSteps } from "./adapters/second-steps/no-second-steps.js";
import { SimpleWebAuthnPasskeyCeremonies } from "./adapters/webauthn/simple-webauthn-passkey-ceremonies.js";
import { UserWebEvents } from "./adapters/websocket/user-web-events.js";
import { Accounts } from "./application/accounts.js";
import { FirstPassword } from "./application/first-password.js";
import { FirstUser } from "./application/first-user.js";
import { PasskeySignIn } from "./application/passkey-sign-in.js";
import { Passkeys } from "./application/passkeys.js";
import { PasswordChecks } from "./application/password-checks.js";
import { PasswordSignIn } from "./application/password-sign-in.js";
import { Passwords } from "./application/passwords.js";
import { SignInWays } from "./application/sign-in-ways.js";
import { SignIns } from "./application/sign-ins.js";
import { SignedInDevices } from "./application/signed-in-devices.js";
import { UnknownEmailTries } from "./application/unknown-email-tries.js";
import { Users } from "./application/users.js";
import { PasskeyCeremonies } from "./ports/passkey-ceremonies.js";
import { PasskeyRepository } from "./ports/passkey-repository.js";
import { PasswordHashing } from "./ports/password-hashing.js";
import { PendingCeremonies } from "./ports/pending-ceremonies.js";
import { SecondSteps } from "./ports/second-steps.js";
import { SignedInDeviceRepository } from "./ports/signed-in-device-repository.js";
import { UserRepository } from "./ports/user-repository.js";

/**
 * Users and signing in (spec §2.10). The composition root binds the platform's `SignedInRequests`
 * to `CookieSignedInRequests` through `RequestAccessModule`, which also gives the controllers
 * `OfficeAddresses`.
 */
@Module({
  imports: [ScheduleModule],
  controllers: [
    SignInController,
    PasskeySignInController,
    AccountController,
    PasskeysController,
    UsersController,
  ],
  providers: [
    { provide: UserRepository, useClass: PostgresUserRepository },
    { provide: SignedInDeviceRepository, useClass: PostgresSignedInDeviceRepository },
    { provide: PasswordHashing, useClass: ScryptPasswordHashing },
    { provide: SecondSteps, useClass: NoSecondSteps },
    { provide: PasskeyRepository, useClass: PostgresPasskeyRepository },
    { provide: PasskeyCeremonies, useClass: SimpleWebAuthnPasskeyCeremonies },
    { provide: PendingCeremonies, useFactory: () => new InMemoryPendingCeremonies() },
    Accounts,
    FirstPassword,
    FirstUser,
    Passkeys,
    PasskeySignIn,
    PasswordChecks,
    PasswordSignIn,
    Passwords,
    SignIns,
    SignInWays,
    SignedInDevices,
    UnknownEmailTries,
    Users,
    CookieSignedInRequests,
    UserWebEvents,
  ],
  exports: [
    Accounts,
    Passwords,
    SignIns,
    SignInWays,
    SignedInDevices,
    Users,
    CookieSignedInRequests,
  ],
})
export class UsersModule {}

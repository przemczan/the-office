import { Module } from "@nestjs/common";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { ScryptPasswordHashing } from "./adapters/crypto/scrypt-password-hashing.js";
import { AccountController } from "./adapters/http/account.controller.js";
import { CookieSignedInRequests } from "./adapters/http/cookie-signed-in-requests.js";
import { SignInController } from "./adapters/http/sign-in.controller.js";
import { UsersController } from "./adapters/http/users.controller.js";
import { PostgresAuthenticatorRepository } from "./adapters/postgres/postgres-authenticator-repository.js";
import { PostgresPendingSignInRepository } from "./adapters/postgres/postgres-pending-sign-in-repository.js";
import { PostgresSignedInDeviceRepository } from "./adapters/postgres/postgres-signed-in-device-repository.js";
import { PostgresUserRepository } from "./adapters/postgres/postgres-user-repository.js";
import { AuthenticatorSecondStep } from "./adapters/second-steps/authenticator-second-step.js";
import { UserWebEvents } from "./adapters/websocket/user-web-events.js";
import { Accounts } from "./application/accounts.js";
import { AuthenticatorCodes } from "./application/authenticator-codes.js";
import { Authenticators } from "./application/authenticators.js";
import { CodeSignIn } from "./application/code-sign-in.js";
import { FirstPassword } from "./application/first-password.js";
import { FirstUser } from "./application/first-user.js";
import { PasswordChecks } from "./application/password-checks.js";
import { PasswordSignIn } from "./application/password-sign-in.js";
import { Passwords } from "./application/passwords.js";
import { PendingSignIns } from "./application/pending-sign-ins.js";
import { SignInWays } from "./application/sign-in-ways.js";
import { SignIns } from "./application/sign-ins.js";
import { SignedInDevices } from "./application/signed-in-devices.js";
import { UnknownEmailTries } from "./application/unknown-email-tries.js";
import { Users } from "./application/users.js";
import { UserWrongTries } from "./application/user-wrong-tries.js";
import { AuthenticatorRepository } from "./ports/authenticator-repository.js";
import { PasswordHashing } from "./ports/password-hashing.js";
import { PendingSignInRepository } from "./ports/pending-sign-in-repository.js";
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
  controllers: [SignInController, AccountController, UsersController],
  providers: [
    { provide: UserRepository, useClass: PostgresUserRepository },
    { provide: SignedInDeviceRepository, useClass: PostgresSignedInDeviceRepository },
    { provide: AuthenticatorRepository, useClass: PostgresAuthenticatorRepository },
    { provide: PendingSignInRepository, useClass: PostgresPendingSignInRepository },
    { provide: PasswordHashing, useClass: ScryptPasswordHashing },
    { provide: SecondSteps, useClass: AuthenticatorSecondStep },
    Accounts,
    AuthenticatorCodes,
    Authenticators,
    CodeSignIn,
    FirstPassword,
    FirstUser,
    PasswordChecks,
    PasswordSignIn,
    Passwords,
    PendingSignIns,
    SignIns,
    SignInWays,
    SignedInDevices,
    UnknownEmailTries,
    Users,
    UserWrongTries,
    CookieSignedInRequests,
    UserWebEvents,
  ],
  exports: [
    Accounts,
    Authenticators,
    Passwords,
    SignIns,
    SignInWays,
    SignedInDevices,
    Users,
    CookieSignedInRequests,
  ],
})
export class UsersModule {}

import { Module } from "@nestjs/common";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { ScryptPasswordHashing } from "./adapters/crypto/scrypt-password-hashing.js";
import { AccountController } from "./adapters/http/account.controller.js";
import { CookieSignedInRequests } from "./adapters/http/cookie-signed-in-requests.js";
import { SignInController } from "./adapters/http/sign-in.controller.js";
import { PostgresSignedInDeviceRepository } from "./adapters/postgres/postgres-signed-in-device-repository.js";
import { PostgresUserRepository } from "./adapters/postgres/postgres-user-repository.js";
import { NoSecondSteps } from "./adapters/second-steps/no-second-steps.js";
import { Accounts } from "./application/accounts.js";
import { EarlierRecordsClaims } from "./application/earlier-records-claims.js";
import { FirstUser } from "./application/first-user.js";
import { PasswordSignIn } from "./application/password-sign-in.js";
import { Passwords } from "./application/passwords.js";
import { SignInWays } from "./application/sign-in-ways.js";
import { SignIns } from "./application/sign-ins.js";
import { SignedInDevices } from "./application/signed-in-devices.js";
import { UnknownEmailTries } from "./application/unknown-email-tries.js";
import { PasswordHashing } from "./ports/password-hashing.js";
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
  controllers: [SignInController, AccountController],
  providers: [
    { provide: UserRepository, useClass: PostgresUserRepository },
    { provide: SignedInDeviceRepository, useClass: PostgresSignedInDeviceRepository },
    { provide: PasswordHashing, useClass: ScryptPasswordHashing },
    { provide: SecondSteps, useClass: NoSecondSteps },
    Accounts,
    EarlierRecordsClaims,
    FirstUser,
    PasswordSignIn,
    Passwords,
    SignIns,
    SignInWays,
    SignedInDevices,
    UnknownEmailTries,
    CookieSignedInRequests,
  ],
  exports: [Accounts, Passwords, SignIns, SignInWays, SignedInDevices, CookieSignedInRequests],
})
export class UsersModule {}

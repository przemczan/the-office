import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { ScryptPasswordHashing } from "./adapters/crypto/scrypt-password-hashing.js";
import { AccountController } from "./adapters/http/account.controller.js";
import { CookieSignedInRequests } from "./adapters/http/cookie-signed-in-requests.js";
import { PasskeySignInController } from "./adapters/http/passkey-sign-in.controller.js";
import { PasskeysController } from "./adapters/http/passkeys.controller.js";
import { SignInController } from "./adapters/http/sign-in.controller.js";
import { UsersController } from "./adapters/http/users.controller.js";
import { IdentitySignInController } from "./adapters/http/identity-sign-in.controller.js";
import { LinkedIdentitiesController } from "./adapters/http/linked-identities.controller.js";
import { InMemoryPendingCeremonies } from "./adapters/in-memory/in-memory-pending-ceremonies.js";
import { PostgresLinkedIdentityRepository } from "./adapters/postgres/postgres-linked-identity-repository.js";
import { PostgresPasskeyRepository } from "./adapters/postgres/postgres-passkey-repository.js";
import { PostgresSignedInDeviceRepository } from "./adapters/postgres/postgres-signed-in-device-repository.js";
import { PostgresUserRepository } from "./adapters/postgres/postgres-user-repository.js";
import { NoSecondSteps } from "./adapters/second-steps/no-second-steps.js";
import { SimpleWebAuthnPasskeyCeremonies } from "./adapters/webauthn/simple-webauthn-passkey-ceremonies.js";
import { UserWebEvents } from "./adapters/websocket/user-web-events.js";
import { Accounts } from "./application/accounts.js";
import { FirstPassword } from "./application/first-password.js";
import { FirstUser } from "./application/first-user.js";
import { IdentityProviders } from "./application/identity-providers.js";
import { IdentitySignIns } from "./application/identity-sign-ins.js";
import { IdentityTrips } from "./application/identity-trips.js";
import { LinkedIdentities } from "./application/linked-identities.js";
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
import type { IdentityProvider } from "./ports/identity-provider.js";
import { LinkedIdentityRepository } from "./ports/linked-identity-repository.js";
import { PasskeyCeremonies } from "./ports/passkey-ceremonies.js";
import { PasskeyRepository } from "./ports/passkey-repository.js";
import { PasswordHashing } from "./ports/password-hashing.js";
import { PendingCeremonies } from "./ports/pending-ceremonies.js";
import { SecondSteps } from "./ports/second-steps.js";
import { SignedInDeviceRepository } from "./ports/signed-in-device-repository.js";
import { UserRepository } from "./ports/user-repository.js";

export interface UsersModuleOptions {
  /** The modules the identity providers' adapters need, such as the github module. */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  /**
   * The identity providers a user links and signs in with, such as `GitHubIdentityProvider`;
   * Continue with Google joins the list with its own adapter.
   */
  readonly identityProviders: readonly Type<IdentityProvider>[];
}

/**
 * Users and signing in (spec §2.10). The composition root binds the platform's `SignedInRequests`
 * to `CookieSignedInRequests` through `RequestAccessModule`, which also gives the controllers
 * `OfficeAddresses`, and registers this once, so the guard and the module share one instance.
 */
@Module({})
export class UsersModule {
  static register({ imports, identityProviders }: UsersModuleOptions): DynamicModule {
    return {
      module: UsersModule,
      imports: [ScheduleModule, ...imports],
      controllers: [
        SignInController,
        PasskeySignInController,
        IdentitySignInController,
        AccountController,
        PasskeysController,
        LinkedIdentitiesController,
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
        { provide: LinkedIdentityRepository, useClass: PostgresLinkedIdentityRepository },
        ...identityProviders,
        {
          provide: IdentityProviders,
          useFactory: (...bound: IdentityProvider[]) => new IdentityProviders(bound),
          inject: [...identityProviders],
        },
        Accounts,
        FirstPassword,
        FirstUser,
        IdentitySignIns,
        IdentityTrips,
        LinkedIdentities,
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
    };
  }
}

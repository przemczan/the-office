import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { ScryptPasswordHashing } from "./adapters/crypto/scrypt-password-hashing.js";
import { AccountController } from "./adapters/http/account.controller.js";
import { FirstRunSetupController } from "./adapters/http/first-run-setup.controller.js";
import { CookieSignedInRequests } from "./adapters/http/cookie-signed-in-requests.js";
import { PasskeySignInController } from "./adapters/http/passkey-sign-in.controller.js";
import { PasskeysController } from "./adapters/http/passkeys.controller.js";
import { SignInController } from "./adapters/http/sign-in.controller.js";
import { UsersController } from "./adapters/http/users.controller.js";
import { GoogleClientController } from "./adapters/http/google-client.controller.js";
import { IdentitySignInController } from "./adapters/http/identity-sign-in.controller.js";
import { LinkedIdentitiesController } from "./adapters/http/linked-identities.controller.js";
import { InMemoryPendingCeremonies } from "./adapters/in-memory/in-memory-pending-ceremonies.js";
import { PostgresFirstRunSetupRepository } from "./adapters/postgres/postgres-first-run-setup-repository.js";
import { PostgresGoogleClientRepository } from "./adapters/postgres/postgres-google-client-repository.js";
import { PostgresLinkedIdentityRepository } from "./adapters/postgres/postgres-linked-identity-repository.js";
import { PostgresAuthenticatorRepository } from "./adapters/postgres/postgres-authenticator-repository.js";
import { PostgresPasskeyRepository } from "./adapters/postgres/postgres-passkey-repository.js";
import { PostgresPendingSignInRepository } from "./adapters/postgres/postgres-pending-sign-in-repository.js";
import { PostgresSignedInDeviceRepository } from "./adapters/postgres/postgres-signed-in-device-repository.js";
import { PostgresUserRepository } from "./adapters/postgres/postgres-user-repository.js";
import { AuthenticatorSecondStep } from "./adapters/second-steps/authenticator-second-step.js";
import { SimpleWebAuthnPasskeyCeremonies } from "./adapters/webauthn/simple-webauthn-passkey-ceremonies.js";
import { UserWebEvents } from "./adapters/websocket/user-web-events.js";
import { Accounts } from "./application/accounts.js";
import { AuthenticatorCodes } from "./application/authenticator-codes.js";
import { Authenticators } from "./application/authenticators.js";
import { CodeSignIn } from "./application/code-sign-in.js";
import { EarlierRecordsClaims } from "./application/earlier-records-claims.js";
import { FirstPassword } from "./application/first-password.js";
import { FirstRunSetup, FirstRunSetupOptions } from "./application/first-run-setup.js";
import { FirstUser } from "./application/first-user.js";
import { GoogleClients } from "./application/google-clients.js";
import { IdentityProviders } from "./application/identity-providers.js";
import { IdentitySignIns } from "./application/identity-sign-ins.js";
import { IdentityTrips } from "./application/identity-trips.js";
import { LinkedIdentities } from "./application/linked-identities.js";
import { PasskeySignIn } from "./application/passkey-sign-in.js";
import { Passkeys } from "./application/passkeys.js";
import { PasswordChecks } from "./application/password-checks.js";
import { PasswordSignIn } from "./application/password-sign-in.js";
import { Passwords } from "./application/passwords.js";
import { PendingSignIns } from "./application/pending-sign-ins.js";
import { SignInWays } from "./application/sign-in-ways.js";
import { SignIns } from "./application/sign-ins.js";
import { SignedInDevices } from "./application/signed-in-devices.js";
import { UnknownEmailTries } from "./application/unknown-email-tries.js";
import { Users } from "./application/users.js";
import type { IdentityProvider } from "./ports/identity-provider.js";
import { FirstRunSetupRepository } from "./ports/first-run-setup-repository.js";
import { GoogleClientRepository } from "./ports/google-client-repository.js";
import { LinkedIdentityRepository } from "./ports/linked-identity-repository.js";
import { UserWrongTries } from "./application/user-wrong-tries.js";
import { AuthenticatorRepository } from "./ports/authenticator-repository.js";
import { PasskeyCeremonies } from "./ports/passkey-ceremonies.js";
import { PasskeyRepository } from "./ports/passkey-repository.js";
import { PasswordHashing } from "./ports/password-hashing.js";
import { PendingCeremonies } from "./ports/pending-ceremonies.js";
import { PendingSignInRepository } from "./ports/pending-sign-in-repository.js";
import { SecondSteps } from "./ports/second-steps.js";
import { SignedInDeviceRepository } from "./ports/signed-in-device-repository.js";
import { UserRepository } from "./ports/user-repository.js";

export interface UsersModuleOptions {
  /** The modules the identity providers' adapters need, such as the github module. */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  /**
   * The identity providers a user links and signs in with: `GitHubIdentityProvider`, and
   * `GoogleIdentityProvider` over the Google OAuth client this module keeps.
   */
  readonly identityProviders: readonly Type<IdentityProvider>[];
  /**
   * `OFFICE_SKIP_SETUP_BASICS`: an automated install leaves out First-run setup's basics, never the
   * setup token or the first user. Off unless given.
   */
  readonly skipSetupBasics?: boolean;
}

/**
 * Users and signing in (spec §2.10). The composition root binds the platform's `SignedInRequests`
 * to `CookieSignedInRequests` through `RequestAccessModule`, which also gives the controllers
 * `OfficeAddresses`, and registers this once, so the guard and the module share one instance.
 */
@Module({})
export class UsersModule {
  static register({
    imports,
    identityProviders,
    skipSetupBasics = false,
  }: UsersModuleOptions): DynamicModule {
    return {
      module: UsersModule,
      imports: [ScheduleModule, ...imports],
      controllers: [
        SignInController,
        FirstRunSetupController,
        PasskeySignInController,
        IdentitySignInController,
        AccountController,
        PasskeysController,
        LinkedIdentitiesController,
        GoogleClientController,
        UsersController,
      ],
      providers: [
        { provide: UserRepository, useClass: PostgresUserRepository },
        { provide: SignedInDeviceRepository, useClass: PostgresSignedInDeviceRepository },
        { provide: AuthenticatorRepository, useClass: PostgresAuthenticatorRepository },
        { provide: PendingSignInRepository, useClass: PostgresPendingSignInRepository },
        { provide: PasswordHashing, useValue: new ScryptPasswordHashing() },
        { provide: SecondSteps, useClass: AuthenticatorSecondStep },
        { provide: PasskeyRepository, useClass: PostgresPasskeyRepository },
        { provide: PasskeyCeremonies, useClass: SimpleWebAuthnPasskeyCeremonies },
        { provide: PendingCeremonies, useFactory: () => new InMemoryPendingCeremonies() },
        { provide: LinkedIdentityRepository, useClass: PostgresLinkedIdentityRepository },
        { provide: GoogleClientRepository, useClass: PostgresGoogleClientRepository },
        { provide: FirstRunSetupRepository, useClass: PostgresFirstRunSetupRepository },
        { provide: FirstRunSetupOptions, useValue: new FirstRunSetupOptions(skipSetupBasics) },
        ...identityProviders,
        {
          provide: IdentityProviders,
          useFactory: (...bound: IdentityProvider[]) => new IdentityProviders(bound),
          inject: [...identityProviders],
        },
        Accounts,
        AuthenticatorCodes,
        Authenticators,
        CodeSignIn,
        EarlierRecordsClaims,
        FirstPassword,
        FirstRunSetup,
        FirstUser,
        GoogleClients,
        IdentitySignIns,
        IdentityTrips,
        LinkedIdentities,
        Passkeys,
        PasskeySignIn,
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
        FirstRunSetup,
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

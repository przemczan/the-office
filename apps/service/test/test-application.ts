import type {
  DynamicModule,
  INestApplication,
  InjectionToken,
  ModuleMetadata,
  Type,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DatabaseModule } from "../src/platform/database/database.module.js";
import { EarlierRecordsModule } from "../src/platform/earlier-records/earlier-records.module.js";
import { configureHttp, HTTP_APPLICATION_OPTIONS } from "../src/platform/http/configure-http.js";
import { OfficeAddresses } from "../src/platform/http/office-addresses.js";
import { SignedInRequests } from "../src/platform/http/signed-in-requests.js";
import {
  EveryoneSignedIn,
  everyoneSignedIn,
} from "../src/platform/http/signed-in-requests.fixtures.js";
import { Schedule } from "../src/platform/schedule/schedule.js";
import { ManualSchedule } from "../src/platform/schedule/schedule.fixtures.js";
import { testDatabaseUrl } from "./test-database.js";

export interface TestApplicationOptions extends ModuleMetadata {
  /**
   * Adds the DatabaseModule, on this run's test database, or on the one at `url`, such as a
   * `freshTestDatabase` for a test that changes rows of every test, as a claim on earlier records.
   */
  readonly database?: boolean | { readonly url: string };
  /**
   * Replaces these providers wherever they are bound, such as a port a module binds itself.
   * `Schedule` is a `ManualSchedule` unless replaced here, so no job runs by the clock in a test.
   */
  readonly overrides?: readonly ProviderOverride[];
  /** Replaces these modules wherever they are imported, such as the engine by a scripted one. */
  readonly moduleOverrides?: readonly ModuleOverride[];
  /**
   * Who may reach the app. By default every request is signed in, at no public address, also in
   * an app with the composition root's own guard. `"guarded"` keeps the `RequestAccessModule` the
   * imports register, such as the composition root's or one the test imports itself.
   */
  readonly requestAccess?: "everyone-signed-in" | "guarded";
}

/** A provider replaced by a value, or by what a factory makes of other providers. */
export type ProviderOverride =
  | { readonly provide: InjectionToken; readonly useValue: unknown }
  | {
      readonly provide: InjectionToken;
      // Nest passes the injected providers as they are bound, untyped.
      readonly useFactory: (...injected: never[]) => unknown;
      readonly inject: readonly InjectionToken[];
    };

export interface ModuleOverride {
  readonly module: Type;
  readonly useModule: Type | DynamicModule;
}

export interface TestApplication {
  readonly app: INestApplication;
  /** Where it serves, such as `http://127.0.0.1:53124`. */
  readonly url: string;
  readonly port: number;
}

/**
 * Boots the given Nest providers, controllers and modules as the service runs them: HTTP
 * configured as in production, on 127.0.0.1 and a free port, without logs. Close `app` after.
 * Every request is taken as signed in, by `SIGNED_IN_FOR_TESTS` or the user its `signedInAs`
 * header names, unless the test asks for its `requestAccess` guarded.
 */
export async function startTestApplication({
  database = false,
  imports = [],
  overrides = [],
  moduleOverrides = [],
  requestAccess = "everyone-signed-in",
  ...metadata
}: TestApplicationOptions): Promise<TestApplication> {
  const unguarded = requestAccess === "everyone-signed-in";
  const builder = Test.createTestingModule({
    ...metadata,
    imports: [
      EarlierRecordsModule,
      ...(database === false
        ? []
        : [DatabaseModule.forRoot({ url: database === true ? testDatabaseUrl() : database.url })]),
      ...(unguarded ? [everyoneSignedIn()] : []),
      ...imports,
    ],
  });
  builder.overrideProvider(Schedule).useValue(new ManualSchedule());
  if (unguarded) {
    builder.overrideProvider(SignedInRequests).useValue(new EveryoneSignedIn());
    builder.overrideProvider(OfficeAddresses).useValue(new OfficeAddresses(undefined));
  }
  for (const override of overrides) {
    const replaced = builder.overrideProvider(override.provide);
    if ("useValue" in override) replaced.useValue(override.useValue);
    else replaced.useFactory({ factory: override.useFactory, inject: [...override.inject] });
  }
  for (const { module, useModule } of moduleOverrides)
    builder.overrideModule(module).useModule(useModule);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ ...HTTP_APPLICATION_OPTIONS, logger: false });
  configureHttp(app);
  try {
    await app.listen(0, "127.0.0.1");
  } catch (error) {
    await app.close();
    throw error;
  }
  const url = await app.getUrl();
  return { app, url, port: Number(new URL(url).port) };
}

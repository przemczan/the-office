import type {
  DynamicModule,
  INestApplication,
  InjectionToken,
  ModuleMetadata,
  Type,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DatabaseModule } from "../src/platform/database/database.module.js";
import { configureHttp, HTTP_APPLICATION_OPTIONS } from "../src/platform/http/configure-http.js";
import { testDatabaseUrl } from "./test-database.js";

export interface TestApplicationOptions extends ModuleMetadata {
  /** Adds the DatabaseModule, on this run's test database. */
  readonly database?: boolean;
  /** Replaces these providers wherever they are bound, such as a port a module binds itself. */
  readonly overrides?: readonly ProviderOverride[];
  /** Replaces these modules wherever they are imported, such as the engine by a scripted one. */
  readonly moduleOverrides?: readonly ModuleOverride[];
}

export interface ProviderOverride {
  readonly provide: InjectionToken;
  readonly useValue: unknown;
}

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
 */
export async function startTestApplication({
  database = false,
  imports = [],
  overrides = [],
  moduleOverrides = [],
  ...metadata
}: TestApplicationOptions): Promise<TestApplication> {
  const builder = Test.createTestingModule({
    ...metadata,
    imports: database ? [DatabaseModule.forRoot({ url: testDatabaseUrl() }), ...imports] : imports,
  });
  for (const { provide, useValue } of overrides)
    builder.overrideProvider(provide).useValue(useValue);
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

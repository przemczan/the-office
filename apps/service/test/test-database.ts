import { inject } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

/**
 * The migrated database created for this test run (test-database.global-setup.ts). Every test
 * file shares it, so a test makes its own rows and finds only those.
 */
export function testDatabaseUrl(): string {
  return inject("testDatabaseUrl");
}

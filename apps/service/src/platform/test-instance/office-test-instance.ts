/** The variable The Office sets in every test instance of itself (spec §6, "Test instances"). */
export const OFFICE_TEST_INSTANCE = "OFFICE_TEST_INSTANCE";

/**
 * Whether this service is a test instance of The Office, started with `OFFICE_TEST_INSTANCE=true`:
 * then it refuses, on the server, to push, open a pull request, merge or close one, and to start an
 * engine. Modules inject it as optional, so a test's app without it runs as no test instance.
 */
export class OfficeTestInstance {
  static readonly OFF = new OfficeTestInstance(false);

  constructor(readonly on: boolean) {}
}

/**
 * Refused because this service is a test instance of The Office (`OFFICE_TEST_INSTANCE=true`),
 * which starts no engine session and reads no engine's usage windows, so no model is called and no
 * account is reached (spec §6, "Test instances").
 */
export class EngineRefused extends Error {
  constructor() {
    super("A test instance of The Office (OFFICE_TEST_INSTANCE) starts no engine session.");
    this.name = "EngineRefused";
  }
}

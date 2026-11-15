import type { ProviderOverride } from "../../../../test/test-application.js";
import { UpdateSystem } from "./update-system.js";

/** The CPU the tests' system says it runs on, whichever one they run on. */
export const TEST_ARCHITECTURE = "x64";

/** A system that updates The Office, or refuses with `refusal`, whichever one the tests run on. */
export function updateSystem(refusal?: string): ProviderOverride {
  return { provide: UpdateSystem, useValue: { refusal, architecture: TEST_ARCHITECTURE } };
}

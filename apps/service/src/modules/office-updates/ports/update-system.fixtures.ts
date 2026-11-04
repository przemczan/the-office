import type { ProviderOverride } from "../../../../test/test-application.js";
import { UpdateSystem } from "./update-system.js";

/** A system that updates The Office, or refuses with `refusal`, whichever one the tests run on. */
export function updateSystem(refusal?: string): ProviderOverride {
  return { provide: UpdateSystem, useValue: { refusal } };
}

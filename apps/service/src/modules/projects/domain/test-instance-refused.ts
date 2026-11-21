/** What a test instance of The Office never does on a remote or a code host (spec §6, "Test instances"). */
export type RefusedInTestInstance = "push" | "open-pull-request" | "merge" | "close-pull-request";

const REFUSED_WORDS: Record<RefusedInTestInstance, string> = {
  push: "doesn't push",
  "open-pull-request": "doesn't open pull requests",
  merge: "doesn't merge",
  "close-pull-request": "doesn't close pull requests",
};

/**
 * Refused because this service is a test instance of The Office (`OFFICE_TEST_INSTANCE=true`),
 * which runs code an Agent wrote and so never reaches a real remote or code host.
 */
export class TestInstanceRefused extends Error {
  constructor(readonly action: RefusedInTestInstance) {
    super(`A test instance of The Office (OFFICE_TEST_INSTANCE) ${REFUSED_WORDS[action]}.`);
    this.name = "TestInstanceRefused";
  }
}

/** Throws TestInstanceRefused for `action` when this service is a test instance. */
export function refuseInTestInstance(testInstance: boolean, action: RefusedInTestInstance): void {
  if (testInstance) throw new TestInstanceRefused(action);
}

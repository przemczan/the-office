import { describe, expect, it } from "vitest";
import {
  LOCAL_CHANGES,
  NO_LAUNCHER,
  NO_UPSTREAM,
  updateRefusal,
  type CheckoutState,
  type UpdateState,
} from "./update-refusal.js";

const cleanState = { localChanges: false, upstream: "origin/main", ahead: 0 };
const clean = checkout(cleanState);

function checkout(state: CheckoutState): UpdateState {
  return { install: "checkout", checkout: state };
}
const launched = { launched: true };

describe("Why Update is refused", () => {
  it("goes ahead on a clean checkout behind its upstream, under the launcher", () => {
    expect(updateRefusal(clean, launched)).toBeUndefined();
  });

  it("refuses local changes, a checkout without an upstream and one that diverged", () => {
    expect(updateRefusal(checkout({ ...cleanState, localChanges: true }), launched)).toBe(
      LOCAL_CHANGES,
    );
    expect(updateRefusal(checkout({ ...cleanState, upstream: undefined }), launched)).toBe(
      NO_UPSTREAM,
    );
    expect(updateRefusal(checkout({ ...cleanState, ahead: 2 }), launched)).toBe(
      "The Office's checkout has diverged from origin/main.",
    );
  });

  it("refuses without the launcher, and first where the system has none", () => {
    expect(updateRefusal(clean, { launched: false })).toBe(NO_LAUNCHER);
    expect(
      updateRefusal(clean, {
        launched: false,
        systemRefusal: "Updating The Office runs on Linux only.",
      }),
    ).toBe("Updating The Office runs on Linux only.");
  });
});

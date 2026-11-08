import { describe, expect, it } from "vitest";
import { checkAwaited } from "./stages-check.ts";

describe("checkAwaited", () => {
  it("waits for the first check", () => {
    expect(checkAwaited({ isPending: true, isPlaceholderData: false })).toBe(true);
  });

  it("waits while the last answer is of Stages since changed", () => {
    expect(checkAwaited({ isPending: false, isPlaceholderData: true })).toBe(true);
  });

  it("doesn't wait on a refetch of the Stages on show, as another Task's event makes", () => {
    const refetching = { isPending: false, isPlaceholderData: false, isFetching: true };

    expect(checkAwaited(refetching)).toBe(false);
  });
});

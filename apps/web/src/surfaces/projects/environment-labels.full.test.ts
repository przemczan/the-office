import { describe, expect, it } from "vitest";
import {
  draftChanged,
  draftOf,
  environmentOf,
  secretValueKept,
  withNewSecret,
} from "./environment-labels.ts";

const ENVIRONMENT = {
  set: [
    { name: "CI", secret: false as const, value: "1" },
    { name: "NPM_TOKEN", secret: true as const, valueSet: true },
  ],
  unset: ["NODE_OPTIONS"],
  prependPath: ["/opt/bin"],
};

describe("draftOf and environmentOf", () => {
  it("show plain variables as lines and Secret variables as rows without their values", () => {
    const draft = draftOf(ENVIRONMENT);

    expect(draft.set).toBe("CI=1");
    expect(draft.secrets).toEqual([
      { key: 0, name: "NPM_TOKEN", keptName: "NPM_TOKEN", typed: undefined },
    ]);
    expect(secretValueKept(draft.secrets[0]!)).toBe(true);
  });

  it("keep a Secret variable's value by leaving it out, and give a typed one", () => {
    const draft = withNewSecret(draftOf(ENVIRONMENT));
    const added = draft.secrets.map((secret) =>
      secret.key === 1 ? { ...secret, name: "SENTRY_TOKEN", typed: "sntry-123456" } : secret,
    );

    expect(environmentOf({ ...draft, secrets: added })).toEqual({
      environment: {
        set: [
          { name: "CI", secret: false, value: "1" },
          { name: "NPM_TOKEN", secret: true },
          { name: "SENTRY_TOKEN", secret: true, value: "sntry-123456" },
        ],
        unset: ["NODE_OPTIONS"],
        prependPath: ["/opt/bin"],
      },
    });
  });

  it("keeps no value for a renamed row", () => {
    const [secret] = draftOf(ENVIRONMENT).secrets;

    expect(secretValueKept({ ...secret!, name: "OTHER_TOKEN" })).toBe(false);
  });
});

describe("draftChanged", () => {
  it("is false for the saved environment's own draft, and true once anything is edited", () => {
    const draft = draftOf(ENVIRONMENT);
    const [secret] = draft.secrets;

    expect(draftChanged(draft, ENVIRONMENT)).toBe(false);
    expect(draftChanged({ ...draft, set: "CI=2" }, ENVIRONMENT)).toBe(true);
    expect(draftChanged({ ...draft, unset: "" }, ENVIRONMENT)).toBe(true);
    expect(draftChanged(withNewSecret(draft), ENVIRONMENT)).toBe(true);
    expect(draftChanged({ ...draft, secrets: [] }, ENVIRONMENT)).toBe(true);
    expect(
      draftChanged({ ...draft, secrets: [{ ...secret!, typed: "new-token" }] }, ENVIRONMENT),
    ).toBe(true);
  });
});

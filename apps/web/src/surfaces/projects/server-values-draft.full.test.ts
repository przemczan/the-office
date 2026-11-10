import type { ProjectServerValue } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  leavesServerOut,
  officeWideWords,
  projectValueWords,
  serverValuesChangeOf,
  serverValuesDraftOf,
} from "./server-values-draft.ts";

const TOKEN: ProjectServerValue = {
  name: "GITHUB_TOKEN",
  secret: true,
  required: true,
  officeWideValueSet: true,
  projectValueSet: true,
};

const OWNER: ProjectServerValue = {
  name: "GITHUB_OWNER",
  secret: false,
  required: false,
  officeWideValue: "acme",
  officeWideValueSet: true,
  projectValueSet: false,
};

describe("a Project's Server values", () => {
  it("starts a plain value from its text and keeps a secret, sending every value back", () => {
    const draft = serverValuesDraftOf([TOKEN, OWNER]);

    expect(draft).toEqual({ GITHUB_TOKEN: undefined, GITHUB_OWNER: "" });
    expect(serverValuesChangeOf([TOKEN, OWNER], { ...draft, GITHUB_OWNER: "octo" })).toEqual({
      serverValues: [{ name: "GITHUB_TOKEN" }, { name: "GITHUB_OWNER", projectValue: "octo" }],
    });
    expect(serverValuesChangeOf([TOKEN], { GITHUB_TOKEN: "" })).toEqual({
      serverValues: [{ name: "GITHUB_TOKEN", projectValue: "" }],
    });
  });

  it("shows a secret only as set, and the Office-wide value where the Project sets none", () => {
    expect(officeWideWords(TOKEN)).toBe("Set");
    expect(projectValueWords(TOKEN)).toBe("Set");
    expect(officeWideWords(OWNER)).toBe("acme");
    expect(projectValueWords(OWNER)).toBe("The Office-wide value");
    expect(
      officeWideWords({ ...OWNER, officeWideValue: undefined, officeWideValueSet: false }),
    ).toBe("Not set");
  });

  it("says a required value set nowhere leaves the server out", () => {
    expect(leavesServerOut(TOKEN)).toBe(false);
    expect(leavesServerOut({ ...TOKEN, officeWideValueSet: false, projectValueSet: false })).toBe(
      true,
    );
  });
});

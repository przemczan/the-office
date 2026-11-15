import { describe, expect, it } from "vitest";
import { compareVersions, isNewer, officeVersionWords, parseVersion } from "./office-version.js";

const version = (text: string) => {
  const parsed = parseVersion(text);
  if (!parsed) throw new Error(`${text} is no version.`);
  return parsed;
};

describe("Office versions", () => {
  it("reads a version with or without the tag's v", () => {
    expect(parseVersion("1.4.0")).toEqual({ major: 1, minor: 4, patch: 0 });
    expect(parseVersion("v12.0.3")).toEqual({ major: 12, minor: 0, patch: 3 });
  });

  it("reads no pre-release, build or loose version", () => {
    for (const text of ["1.4.0-rc.1", "1.4.0+build", "1.4", "01.2.3", "latest", "v"]) {
      expect(parseVersion(text)).toBeUndefined();
    }
  });

  it("orders versions by number, not by text", () => {
    expect(isNewer(version("1.10.0"), version("1.9.9"))).toBe(true);
    expect(isNewer(version("1.4.0"), version("1.4.0"))).toBe(false);
    expect(compareVersions(version("2.0.0"), version("10.0.0"))).toBeLessThan(0);
  });

  it("names a commit shortened and a version whole", () => {
    expect(officeVersionWords("0123456789abcdef0123456789abcdef01234567")).toBe("0123456");
    expect(officeVersionWords("1.4.0")).toBe("1.4.0");
  });
});

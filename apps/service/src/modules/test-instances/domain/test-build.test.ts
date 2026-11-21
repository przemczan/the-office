import { describe, expect, it } from "vitest";
import {
  buildFailureOf,
  initiativeEndedLongAgo,
  keptNamesOf,
  mediaTypeOf,
  outputPatternProblem,
} from "./test-build.js";

describe("Build to install builds", () => {
  it("names why a build failed, and nothing for exit 0 or a stop", () => {
    expect(buildFailureOf({ exitCode: 0 })).toBeUndefined();
    expect(buildFailureOf({ exitCode: undefined, endedBy: "stop" })).toBeUndefined();
    expect(buildFailureOf({ exitCode: 2 })).toBe("The build ended with exit code 2.");
    expect(buildFailureOf({ exitCode: undefined, endedBy: "timeout" })).toBe(
      "The build ran out of its 60 minutes.",
    );
    expect(buildFailureOf({ exitCode: 127, endedBy: "could-not-run" })).toBe(
      "The build couldn't run.",
    );
  });

  it("refuses an output pattern leading out of the checkout", () => {
    expect(outputPatternProblem("app/build/**/*.apk")).toBeUndefined();
    expect(outputPatternProblem("../other/*.apk")).toBe(
      "The output pattern ../other/*.apk leads outside the checkout.",
    );
    expect(outputPatternProblem("out/../../x.apk")).toContain("leads outside the checkout");
    expect(outputPatternProblem("/etc/passwd")).toContain("leads outside the checkout");
    expect(outputPatternProblem("C:\\Windows\\x.apk")).toContain("leads outside the checkout");
  });

  it("keeps each file under its base name, a second of the same name numbered", () => {
    expect(
      keptNamesOf([
        "app/build/outputs/apk/debug/app.apk",
        "app/build/outputs/apk/release/app.apk",
        "wear/app.apk",
        "mapping.txt",
        "README",
        "x/README",
      ]),
    ).toEqual(["app.apk", "app-2.apk", "app-3.apk", "mapping.txt", "README", "README-2"]);
  });

  it("serves an APK as Android installs it, anything else as plain bytes", () => {
    expect(mediaTypeOf("app.APK")).toBe("application/vnd.android.package-archive");
    expect(mediaTypeOf("app.aab")).toBe("application/octet-stream");
  });

  it("drops an ended Initiative's builds 7 days after it ended, not at 6", () => {
    const ended = new Date("2003-04-05T10:00:00Z");
    const day = 24 * 60 * 60_000;
    expect(initiativeEndedLongAgo(ended, new Date(ended.getTime() + 6 * day))).toBe(false);
    expect(initiativeEndedLongAgo(ended, new Date(ended.getTime() + 7 * day))).toBe(true);
    expect(initiativeEndedLongAgo(undefined, new Date())).toBe(false);
  });
});

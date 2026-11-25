import { describe, expect, it } from "vitest";
import {
  adbInstallArguments,
  apksOf,
  buildFailed,
  holderNameOf,
  installFailureOf,
} from "./device-install.js";

describe("an install's adb", () => {
  it("installs one .apk with install, several with install-multiple, from the files' mount", () => {
    expect(adbInstallArguments("emulator-5554", "/office-test-build", ["app.apk"])).toEqual([
      "-s",
      "emulator-5554",
      "install",
      "-r",
      "/office-test-build/app.apk",
    ]);
    expect(
      adbInstallArguments("emulator-5554", "/office-test-build", ["base.apk", "split.apk"]),
    ).toEqual([
      "-s",
      "emulator-5554",
      "install-multiple",
      "-r",
      "/office-test-build/base.apk",
      "/office-test-build/split.apk",
    ]);
  });

  it("installs only the .apk files", () => {
    expect(apksOf(["app.apk", "mapping.txt", "Other.APK"])).toEqual({
      apks: ["app.apk", "Other.APK"],
      others: ["mapping.txt"],
    });
  });

  it("reads Success, the phone's refusal, a device that didn't answer and anything else", () => {
    expect(
      installFailureOf({ exitCode: 0, output: "Performing Streamed Install\nSuccess\n" }, "Pixel"),
    ).toBeUndefined();
    expect(
      installFailureOf(
        {
          exitCode: 1,
          output:
            "adb: failed to install /office-test-build/app.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match]\n",
        },
        "Pixel",
      ),
    ).toBe("The phone refused the install: INSTALL_FAILED_UPDATE_INCOMPATIBLE.");
    expect(
      installFailureOf({ exitCode: 1, output: "adb: device '10.0.0.2:5555' not found\n" }, "Pixel"),
    ).toBe("Pixel didn't answer.");
    expect(installFailureOf({ exitCode: 1, output: "something odd\n" }, "Pixel")).toBe(
      "adb couldn't install the app: something odd",
    );
    expect(installFailureOf({ exitCode: undefined, output: "" }, "Pixel")).toBe(
      "adb ended without an exit code.",
    );
  });

  it("names the build's failure and the holder as the limit names an instance", () => {
    expect(buildFailed("The build ended with exit code 2.")).toBe(
      "The build failed: The build ended with exit code 2.",
    );
    expect(holderNameOf({ targetName: "Install on Pixel", branch: "main" })).toBe(
      "Install on Pixel on main",
    );
    expect(holderNameOf({ targetName: "Install on Pixel", initiativeName: "Checkout" })).toBe(
      "Install on Pixel in Checkout",
    );
  });
});

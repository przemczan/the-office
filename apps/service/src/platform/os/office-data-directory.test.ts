import { describe, expect, it } from "vitest";
import { defaultOfficeDataDirectory } from "./office-data-directory.js";

describe("defaultOfficeDataDirectory", () => {
  describe("on Windows", () => {
    const homeDirectory = "C:\\Users\\office";

    it("is the-office in %LOCALAPPDATA%", () => {
      const directory = defaultOfficeDataDirectory("windows", {
        environment: { LOCALAPPDATA: "D:\\Profiles\\office\\AppData\\Local" },
        homeDirectory,
      });

      expect(directory).toBe("D:\\Profiles\\office\\AppData\\Local\\the-office");
    });

    it.each([
      ["unset", undefined],
      ["blank", ""],
    ])("falls back to AppData\\Local in the home directory when LOCALAPPDATA is %s", (_, value) => {
      const directory = defaultOfficeDataDirectory("windows", {
        environment: { LOCALAPPDATA: value },
        homeDirectory,
      });

      expect(directory).toBe("C:\\Users\\office\\AppData\\Local\\the-office");
    });
  });

  describe("on Linux", () => {
    const homeDirectory = "/home/office";

    it("is the-office in $XDG_DATA_HOME", () => {
      const directory = defaultOfficeDataDirectory("linux", {
        environment: { XDG_DATA_HOME: "/data/office" },
        homeDirectory,
      });

      expect(directory).toBe("/data/office/the-office");
    });

    it.each([
      ["unset", undefined],
      ["blank", ""],
      ["relative", "data/office"],
    ])("falls back to ~/.local/share when XDG_DATA_HOME is %s", (_, value) => {
      const directory = defaultOfficeDataDirectory("linux", {
        environment: { XDG_DATA_HOME: value },
        homeDirectory,
      });

      expect(directory).toBe("/home/office/.local/share/the-office");
    });
  });
});

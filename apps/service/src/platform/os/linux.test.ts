import { describe, expect, it } from "vitest";
import { linux } from "./linux.js";

const homeDirectory = "/home/office";

describe("linux", () => {
  describe("paths.resolve, isWithin and names", () => {
    const { paths } = linux({ variables: {}, homeDirectory });

    it("finds a path inside a folder by its exact case, and never a sibling that shares a prefix", () => {
      expect(paths.isWithin("/home/office/.ssh/id", "/home/office/.ssh")).toBe(true);
      expect(paths.isWithin("/home/office/.SSH/id", "/home/office/.ssh")).toBe(false);
      expect(paths.isWithin("/home/office/.sshx", "/home/office/.ssh")).toBe(false);
    });
  });

  it("keeps secrets in the home directory and $XDG_CONFIG_HOME", () => {
    const { secretPaths } = linux({
      variables: { XDG_CONFIG_HOME: "/config" },
      homeDirectory,
    });

    expect(secretPaths).toEqual(
      expect.arrayContaining([
        "/home/office/.ssh",
        "/home/office/.claude/.credentials.json",
        "/config/gh",
        "/home/office/.aws",
        "/config/google-chrome",
        "/home/office/.mozilla/firefox",
      ]),
    );
  });

  it("puts a local socket in the temporary folder, and quotes a hook's words for bash", () => {
    const system = linux({ variables: { TMPDIR: "/run/tmp" }, homeDirectory });

    expect(system.localSocketPath("office-gemini-1")).toBe("/run/tmp/office-gemini-1.sock");
    expect(system.nodeScriptHookCommand("/srv/relay.js", ["hook", "/data/it's.json"])).toBe(
      `'${process.execPath}' '/srv/relay.js' 'hook' '/data/it'\\''s.json'`,
    );
  });
});

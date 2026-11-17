import { describe, expect, it } from "vitest";
import { codexBuild } from "./codex-build.js";

describe("codexBuild", () => {
  it("names the binary inside the platform package, as Codex's launcher finds it", () => {
    expect(codexBuild("linux", "unknown-linux-musl", "codex", "x64")).toBe(
      "linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex",
    );
    expect(codexBuild("win32", "pc-windows-msvc", "codex.exe", "arm64")).toBe(
      "win32-arm64/vendor/aarch64-pc-windows-msvc/bin/codex.exe",
    );
  });

  it("has none for a processor Codex isn't built for", () => {
    expect(codexBuild("linux", "unknown-linux-musl", "codex", "ia32")).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { remoteNeedsLine } from "./remote-needs-words.ts";

describe("remoteNeedsLine", () => {
  it("says GitHub over https takes Sign in with GitHub, and whether it is missing", () => {
    const signedOut = remoteNeedsLine({ kind: "github-https", missing: ["sign-in-with-github"] });
    const signedIn = remoteNeedsLine({ kind: "github-https", missing: [] });

    expect(signedOut).toEqual({
      needs: "Its remote is GitHub over https, reached with Sign in with GitHub.",
      missing: ["Not signed in with GitHub."],
      inSettings: true,
    });
    expect(signedIn.missing).toEqual([]);
  });

  it("names an ssh host, its port unless ssh's own, and what of the Office ssh key is missing", () => {
    const line = remoteNeedsLine({
      kind: "ssh",
      host: "git.example",
      port: 2222,
      missing: ["office-ssh-key", "host-key"],
    });

    expect(line.needs).toBe(
      "Its remote, git.example:2222, is reached over ssh with the Office ssh key, whose public half the host needs.",
    );
    expect(line.missing).toEqual([
      "The Office ssh key isn't made yet.",
      "git.example's host key isn't confirmed yet: it becomes a Trusted host once its fingerprint is confirmed.",
    ]);
    expect(line.inSettings).toBe(true);
    expect(
      remoteNeedsLine({ kind: "ssh", host: "git.example", port: 22, missing: [] }).needs,
    ).toContain("Its remote, git.example, is reached over ssh");
  });

  it("needs nothing of the identity for another https host, a local folder or a refused scheme", () => {
    const lines = [
      remoteNeedsLine({ kind: "anonymous-https", host: "git.example" }),
      remoteNeedsLine({ kind: "local" }),
      remoteNeedsLine({ kind: "refused", scheme: "http" }),
    ];

    expect(lines.map(({ needs }) => needs)).toEqual([
      "Its remote, git.example, is reached anonymously over https, so only a public repository can be fetched.",
      "Its remote is a folder on this workstation, which needs nothing of the Office identity.",
      "Its remote is reached by http, which The Office refuses: it reaches remotes over https and ssh only.",
    ]);
    expect(lines.every(({ missing, inSettings }) => missing.length === 0 && !inSettings)).toBe(
      true,
    );
  });
});

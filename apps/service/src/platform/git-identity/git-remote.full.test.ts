import { describe, expect, it } from "vitest";
import { parseGitRemote } from "./git-remote.js";

describe("parseGitRemote", () => {
  it.each([
    ["https://github.com/octo/repo.git", { transport: "https", host: "github.com" }],
    ["https://GitLab.example.com:8443/a/b", { transport: "https", host: "gitlab.example.com" }],
    ["ssh://git@github.com/octo/repo.git", { transport: "ssh", host: "github.com", port: 22 }],
    ["ssh://git@example.com:2222/repo", { transport: "ssh", host: "example.com", port: 2222 }],
    ["git+ssh://example.com:443/repo", { transport: "ssh", host: "example.com", port: 443 }],
    ["ssh://git@[::1]:2222/repo", { transport: "ssh", host: "::1", port: 2222 }],
    ["git@github.com:octo/repo.git", { transport: "ssh", host: "github.com", port: 22 }],
    ["example.com:repo", { transport: "ssh", host: "example.com", port: 22 }],
    ["git@[example.com:2222]:repo", { transport: "ssh", host: "example.com", port: 2222 }],
    ["file:///srv/repo.git", { transport: "local" }],
    ["/srv/repo.git", { transport: "local" }],
    ["../repo", { transport: "local" }],
    ["C:\\repos\\repo", { transport: "local" }],
    ["C:/repos/repo", { transport: "local" }],
    ["./a:b", { transport: "local" }],
    ["git://example.com/repo", { transport: "other", scheme: "git" }],
    ["http://example.com/repo", { transport: "other", scheme: "http" }],
    ["ext::sh -c touch% /tmp/x", { transport: "other", scheme: "ext" }],
    ["https::example.com/repo", { transport: "other", scheme: "https" }],
  ])("reads %s", (remote, expected) => {
    expect(parseGitRemote(remote)).toEqual(expected);
  });
});

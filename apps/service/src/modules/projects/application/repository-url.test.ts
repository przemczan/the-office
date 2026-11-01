import { describe, expect, it } from "vitest";
import { cloneFolderOf, readRepositoryUrl, type RepositoryUrl } from "./repository-url.js";

function read(given: string): RepositoryUrl {
  const reading = readRepositoryUrl(given);
  if (reading.kind !== "url") throw new Error(reading.problem);
  return reading.repositoryUrl;
}

function problemOf(given: string): string {
  const reading = readRepositoryUrl(given);
  if (reading.kind !== "refused") throw new Error(`${given} was read as a Repository URL.`);
  return reading.problem;
}

describe("readRepositoryUrl", () => {
  it.each([
    ["https://github.com/acme/shop", "github.com", ["acme", "shop"], true],
    [" https://GitHub.com/acme/shop.git/ ", "github.com", ["acme", "shop"], true],
    [
      "ssh://git@gitlab.example.com:2222/group/sub/app.git",
      "gitlab.example.com",
      ["group", "sub", "app"],
      false,
    ],
    ["git@github.com:acme/shop.git", "github.com", ["acme", "shop"], true],
    ["git@[git.example.com]:acme/shop", "git.example.com", ["acme", "shop"], false],
    ["git+ssh://git.example.com/acme/shop", "git.example.com", ["acme", "shop"], false],
  ])("reads %s", (given, host, path, onGitHub) => {
    expect(read(given)).toEqual({ url: given.trim(), host, path, onGitHub });
  });

  it("puts every spelling of one repository in one folder", () => {
    const folders = [
      "https://github.com/Acme/Shop",
      "git@github.com:acme/shop.git",
      "ssh://git@github.com/acme/shop",
    ].map((given) => cloneFolderOf(read(given)));
    expect(new Set(folders.map((folder) => folder.join("/")))).toEqual(
      new Set(["github.com/acme/shop"]),
    );
  });

  it.each([
    ["http://example.com/acme/shop", /not http\.$/],
    ["git://example.com/acme/shop", /not git\.$/],
    ["file:///srv/repos/shop", /added by its path/],
    ["C:\\repos\\shop", /added by its path/],
    ["/srv/repos/shop", /added by its path/],
    ["ext::ssh -i key host %S shop", /not ext\.$/],
    ["https://user:token@github.com/acme/shop", /without a user name or token/],
    ["https://user@github.com/acme/shop", /without a user name or token/],
    ["ssh://git:secret@example.com/acme/shop", /without a password/],
    ["https://github.com/acme/shop?tab=code", /^Give a git URL/],
    ["https://github.com/shop", /names a repository and its owner/],
    ["https://github.com/acme/../shop", /names a repository and its owner/],
    ["git@example.com:acme/..", /under the name "\.\."/],
    ["git@example.com:acme//shop", /under the name ""/],
    ["https://example.com/acme/con", /under the name "con"/],
    ["https://example.com/acme/sh%3Ap", /under the name "sh%3Ap"/],
    ["https://[::1]/acme/shop", /on \[::1\]\.$/],
    ["", /^Give the repository's URL\.$/],
  ])("refuses %s", (given, problem) => {
    expect(problemOf(given)).toMatch(problem);
  });
});

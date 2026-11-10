import { describe, expect, it } from "vitest";
import { repositoryOnGitHubOf } from "./pull-request.js";

const GITHUB = "https://github.com";

describe("the repository on GitHub a remote names", () => {
  it.each([
    "https://github.com/notnullsoft/admin.git",
    "https://github.com/notnullsoft/admin",
    "https://github.com/notnullsoft/admin/",
    "git@github.com:notnullsoft/admin.git",
    "ssh://git@github.com/notnullsoft/admin.git",
    "ssh://git@GitHub.com:22/notnullsoft/admin",
  ])("reads %s as notnullsoft/admin", (remote) => {
    expect(repositoryOnGitHubOf(remote, GITHUB)).toEqual({ owner: "notnullsoft", name: "admin" });
  });

  it.each([
    ["another host", "https://gitlab.com/notnullsoft/admin.git"],
    ["another host over ssh", "git@gitlab.com:notnullsoft/admin.git"],
    ["plain http, another origin than GitHub's website", "http://github.com/notnullsoft/admin"],
    ["a path on this computer", "C:/repositories/admin"],
    ["a folder", "/srv/git/admin.git"],
    ["no owner", "https://github.com/admin"],
    ["more than owner and name", "https://github.com/notnullsoft/admin/tree/main"],
  ])("names none for %s", (_, remote) => {
    expect(repositoryOnGitHubOf(remote, GITHUB)).toBeUndefined();
  });

  it("matches GitHub's website by origin, port included, as the identity's credential helper does", () => {
    const fake = "http://127.0.0.1:4000";
    expect(repositoryOnGitHubOf("http://127.0.0.1:4000/office/tools.git", fake)).toEqual({
      owner: "office",
      name: "tools",
    });
    expect(repositoryOnGitHubOf("http://127.0.0.1:4001/office/tools.git", fake)).toBeUndefined();
  });
});

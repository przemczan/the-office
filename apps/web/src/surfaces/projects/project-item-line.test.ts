import { describe, expect, it } from "vitest";
import { whereItLives } from "./project-item-line.tsx";

describe("whereItLives", () => {
  it("says owner/repository from the Repository URL, in its own case, whatever its form", () => {
    for (const repositoryUrl of [
      "https://github.com/NotNullSoft/the-office.git",
      "git@github.com:NotNullSoft/the-office.git",
      "ssh://git@github.com:22/NotNullSoft/the-office",
    ])
      expect(whereItLives({ path: "/srv/office", repositoryUrl })).toBe("NotNullSoft/the-office");
  });

  it("keeps a repository's groups", () => {
    expect(
      whereItLives({
        path: "/srv/shop",
        repositoryUrl: "https://gitlab.example.test/acme/web/shop.git",
      }),
    ).toBe("acme/web/shop");
  });

  it("says the folder's name for a Project added by folder, on Windows or Linux", () => {
    expect(whereItLives({ path: "/home/ada/projects/notes/", repositoryUrl: null })).toBe("notes");
    expect(whereItLives({ path: "D:\\Projects\\the-office", repositoryUrl: null })).toBe(
      "the-office",
    );
  });
});

import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pinnedVersionOf } from "../../domain/installed-source.js";
import { SourceNotFetched } from "../../ports/source-fetcher.js";
import { GitSourceFetcher } from "./git-source-fetcher.js";
import {
  createSourceRepository,
  sourceSkillMd,
  type SourceRepository,
} from "./source-repository.fixtures.js";

/** git on Windows is slow while every test file runs at once. */
const GIT_TEST_TIMEOUT_MS = 30_000;
const LIMITS = { files: 10, bytes: 1024 };
const fetcher = new GitSourceFetcher();
let source: SourceRepository;

beforeEach(async () => {
  source = await createSourceRepository();
});

afterEach(async () => {
  await source.remove();
});

const text = (value: string) => new TextEncoder().encode(value);

describe("refs", { timeout: GIT_TEST_TIMEOUT_MS }, () => {
  it("lists HEAD and every tag, an annotated one with the commit it points at", async () => {
    await source.write("SKILL.md", sourceSkillMd("Notes."));
    const first = source.commit();
    source.tag("v1.0", "annotated");
    await source.write("README.md", "More.");
    const second = source.commit();
    source.tag("v1.1");

    const refs = await fetcher.refs(source.url);

    expect(refs).toContainEqual({ name: "HEAD", commit: second });
    expect(refs).toContainEqual({ name: "refs/tags/v1.0^{}", commit: first });
    expect(refs).toContainEqual({ name: "refs/tags/v1.1", commit: second });
    expect(pinnedVersionOf(refs)).toEqual({ tag: "v1.1", commit: second });
  });

  it("refuses a source that is no repository, in git's words", async () => {
    const missing = pathToFileURL(join(tmpdir(), "office-no-such-source.git")).href;

    await expect(fetcher.refs(missing)).rejects.toThrow(SourceNotFetched);
  });
});

describe("skillFolders", { timeout: GIT_TEST_TIMEOUT_MS }, () => {
  it("reads each folder holding a SKILL.md at the pinned commit, with its files' bytes", async () => {
    await source.write("README.md", "Skills.");
    await source.write("skills/notes/SKILL.md", sourceSkillMd("Notes."));
    await source.write("skills/notes/scripts/run.sh", "#!/bin/sh\n");
    await source.write("skills/logo/SKILL.md", sourceSkillMd("Logo."));
    await source.write("skills/logo/logo.bin", new Uint8Array([0, 10, 255, 10]));
    const commit = source.commit();

    const folders = await fetcher.skillFolders({
      url: source.url,
      pinnedVersion: { commit },
      limits: LIMITS,
    });

    expect(folders).toEqual([
      {
        folder: "skills/logo",
        entries: [
          { kind: "file", path: "SKILL.md", content: text(sourceSkillMd("Logo.")) },
          { kind: "file", path: "logo.bin", content: new Uint8Array([0, 10, 255, 10]) },
        ],
      },
      {
        folder: "skills/notes",
        entries: [
          { kind: "file", path: "SKILL.md", content: text(sourceSkillMd("Notes.")) },
          { kind: "file", path: "scripts/run.sh", content: text("#!/bin/sh\n") },
        ],
      },
    ]);
  });

  it("reads an older commit than the newest, and only the folder asked for", async () => {
    await source.write("SKILL.md", sourceSkillMd("First."));
    const first = source.commit();
    await source.write("SKILL.md", sourceSkillMd("Second."));
    source.commit();

    const folders = await fetcher.skillFolders({
      url: source.url,
      pinnedVersion: { commit: first },
      folder: "",
      limits: LIMITS,
    });

    expect(folders).toEqual([
      {
        folder: "",
        entries: [{ kind: "file", path: "SKILL.md", content: text(sourceSkillMd("First.")) }],
      },
    ]);
  });

  it("fetches a pinned tag, annotated or not", async () => {
    await source.write("SKILL.md", sourceSkillMd("Notes."));
    const commit = source.commit();
    source.tag("v2.0.0", "annotated");

    const [folder] = await fetcher.skillFolders({
      url: source.url,
      pinnedVersion: { tag: "v2.0.0", commit },
      limits: LIMITS,
    });

    expect(folder?.folder).toBe("");
  });

  it("refuses a pinned tag that has moved to another commit", async () => {
    await source.write("SKILL.md", sourceSkillMd("Notes."));
    const first = source.commit();
    await source.write("SKILL.md", sourceSkillMd("Moved."));
    source.commit();
    source.tag("v1.0");

    await expect(
      fetcher.skillFolders({
        url: source.url,
        pinnedVersion: { tag: "v1.0", commit: first },
        limits: LIMITS,
      }),
    ).rejects.toThrow(/its tag v1\.0 points at .+ now, not at the pinned/);
  });

  it("marks links, and a folder over the limits without reading it", async () => {
    await source.write("linked/SKILL.md", sourceSkillMd("Linked."));
    source.link("linked/outside.md", "../../secrets.md");
    await source.write("large/SKILL.md", sourceSkillMd("Large."));
    await source.write("large/data.txt", "x".repeat(LIMITS.bytes));
    const commit = source.commit();

    const folders = await fetcher.skillFolders({
      url: source.url,
      pinnedVersion: { commit },
      limits: LIMITS,
    });

    expect(folders).toEqual([
      { folder: "large", tooLarge: true },
      {
        folder: "linked",
        entries: [
          { kind: "file", path: "SKILL.md", content: text(sourceSkillMd("Linked.")) },
          { kind: "link", path: "outside.md" },
        ],
      },
    ]);
  });
});

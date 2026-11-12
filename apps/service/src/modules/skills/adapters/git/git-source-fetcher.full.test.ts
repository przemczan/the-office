import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { officeIdentityForTests } from "../../../../platform/git-identity/office-identity.fixtures.js";
import {
  userCredentials,
  type UserCredentials,
} from "../../../../platform/git-identity/user-credentials.fixtures.js";
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
const fetcher = new GitSourceFetcher(officeIdentityForTests());
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

describe("diff", { timeout: GIT_TEST_TIMEOUT_MS }, () => {
  it("diffs the skill's folder between two pinned versions, its paths inside the folder", async () => {
    await source.write("skills/notes/SKILL.md", sourceSkillMd("First."));
    await source.write("skills/other/SKILL.md", sourceSkillMd("Other."));
    const first = source.commit();
    source.tag("v1");
    await source.write("skills/notes/SKILL.md", sourceSkillMd("Second."));
    await source.write("skills/other/SKILL.md", sourceSkillMd("Changed too."));
    const second = source.commit();

    const diff = await fetcher.diff({
      url: source.url,
      folder: "skills/notes",
      from: { tag: "v1", commit: first },
      to: { commit: second },
    });

    expect(diff).toContain("--- a/SKILL.md");
    expect(diff).toContain("-description: First.");
    expect(diff).toContain("+description: Second.");
    expect(diff).not.toContain("Changed too.");
  });
});

describe("on the Office identity", { timeout: GIT_TEST_TIMEOUT_MS }, () => {
  /** Nothing listens on port 1, so ssh fails once it has picked its key and config. */
  const SSH_REMOTE = "ssh://git@127.0.0.1:1/";
  let officeData: string;
  let user: UserCredentials;

  beforeEach(async () => {
    officeData = join(tmpdir(), `office-data-${randomUUID()}`);
    user = await userCredentials("https://rewritten.example");
    for (const [name, value] of Object.entries(user.environment)) {
      if (value !== undefined && value !== process.env[name]) vi.stubEnv(name, value);
    }
    // The user's config rewrites the Source's https URL to ssh.
    execFileSync(
      "git",
      ["config", "--global", `url.${SSH_REMOTE}.insteadOf`, "https://rewritten.example/"],
      // Outside any repository, as --global needs none: the test then doesn't depend on the
      // repository it runs in.
      { env: user.environment, cwd: tmpdir() },
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await user.remove();
    await rm(officeData, { recursive: true, force: true });
  });

  it("reaches the URL git resolves for a Source with the Office ssh key alone", async () => {
    const identifiedFetcher = new GitSourceFetcher(officeIdentityForTests(officeData));

    await expect(
      identifiedFetcher.refs("https://rewritten.example/skills.git"),
    ).rejects.toBeInstanceOf(SourceNotFetched);

    await access(join(officeData, "identity", "office_ssh_key"));
    expect(await user.reached()).toEqual([]);
  });
});

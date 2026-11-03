import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CommandLineOfficeCheckout } from "./command-line-office-checkout.js";
import { createOfficeCheckout, type OfficeCheckoutForTests } from "./office-checkout.fixtures.js";

let folder: string;
let fixture: OfficeCheckoutForTests;
let checkout: CommandLineOfficeCheckout;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-checkout-"));
  fixture = await createOfficeCheckout(folder);
  checkout = new CommandLineOfficeCheckout(fixture.path);
});

afterEach(() => rm(folder, { recursive: true, force: true }));

describe("The Office's checkout against its upstream", () => {
  it("reads the current commit with its subject and date", async () => {
    const current = await checkout.current();

    expect(current.commit).toBe(await fixture.head());
    expect(current.subject).toBe("The first version");
    expect(current.committedAt.getTime()).not.toBeNaN();
  });

  it("is up to date with nothing newer upstream", async () => {
    const read = await checkout.readUpstream();

    expect(read).toMatchObject({ upstream: "origin/main", ahead: 0, localChanges: false });
    expect(read.behind).toEqual([]);
    expect(read.newest?.commit).toBe(await fixture.head());
  });

  it("fetches the upstream and lists the commits it is behind, newest first", async () => {
    const [older, newer] = await fixture.pushNewer("Add the launcher", "Add Settings › Updates");

    const read = await checkout.readUpstream();

    expect(read.behind.map(({ commit, subject }) => ({ commit, subject }))).toEqual([
      { commit: newer, subject: "Add Settings › Updates" },
      { commit: older, subject: "Add the launcher" },
    ]);
    expect(read.newest?.commit).toBe(newer);
    expect(read.fetchProblem).toBeUndefined();
  });

  it("sees local changes to tracked files", async () => {
    await fixture.changeLocally();

    expect((await checkout.readUpstream()).localChanges).toBe(true);
  });

  it("counts commits its upstream doesn't have, as a checkout that diverged", async () => {
    await fixture.pushNewer("Upstream's");
    await fixture.commitLocally("Mine");

    const read = await checkout.readUpstream();

    expect(read.ahead).toBe(1);
    expect(read.behind).toHaveLength(1);
  });

  it("has no upstream on a branch that tracks none", async () => {
    const detached = new CommandLineOfficeCheckout(fixture.path);
    await import("node:child_process").then(({ execFileSync }) =>
      execFileSync("git", ["switch", "--quiet", "-c", "local-only"], { cwd: fixture.path }),
    );

    const read = await detached.readUpstream();

    expect(read.upstream).toBeUndefined();
    expect(read.behind).toEqual([]);
  });

  it("tells a fetch that fails, and reads on from what was fetched before", async () => {
    await rm(fixture.upstream, { recursive: true, force: true });

    const read = await checkout.readUpstream();

    expect(read.fetchProblem).toMatch(/^The upstream couldn't be fetched: /);
    expect(read.upstream).toBe("origin/main");
  });
});

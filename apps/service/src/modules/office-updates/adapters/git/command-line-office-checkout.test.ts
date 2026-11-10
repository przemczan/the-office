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
});

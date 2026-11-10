import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { WorkstationLanguageServers } from "./workstation-language-servers.js";

const names = (servers: readonly { readonly command: string }[]): string[] =>
  servers.map(({ command }) => command);

describe("WorkstationLanguageServers", () => {
  let root: string;
  let commands: string;
  let languageServers: WorkstationLanguageServers;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "office-language-servers-"));
    commands = join(root, "bin");
    await mkdir(commands);
    languageServers = new WorkstationLanguageServers(new OfficeDataDirectory(join(root, "data")));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function install(command: string): Promise<void> {
    await writeFile(join(commands, command), "");
    await chmod(join(commands, command), 0o755);
  }

  it("gives a session the servers on its PATH and leaves out the rest", async () => {
    await install("clangd");

    const prepared = await languageServers.prepare("s1", {
      PATH: [join(root, "missing"), commands].join(delimiter),
    });

    expect(names(prepared.servers)).toEqual(["clangd"]);
    expect(names(prepared.leftOut)).toEqual(["typescript-language-server", "kotlin-lsp"]);
  });

  it("leaves out a server that can't run", async () => {
    await writeFile(join(commands, "clangd"), "");
    await chmod(join(commands, "clangd"), 0o644);

    const prepared = await languageServers.prepare("s1", { PATH: commands });

    expect(prepared.servers).toEqual([]);
  });

  it("keeps a session's servers fixed, whatever is installed since", async () => {
    await install("clangd");
    const { servers } = await languageServers.prepare("s1", { PATH: commands });
    await install("kotlin-lsp");

    await expect(languageServers.recorded("s1")).resolves.toEqual(servers);
  });

  it("has none for a session that kept no record", async () => {
    await expect(languageServers.recorded("older")).resolves.toEqual([]);
  });
});

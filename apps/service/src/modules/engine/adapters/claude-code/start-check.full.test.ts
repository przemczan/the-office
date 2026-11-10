import { join } from "node:path";
import type { SDKSystemMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { initProblems, startCheckProblems } from "./start-check.js";
import { paths, folder, skills, anEngine, setUpEachTest } from "./start-check.fixtures.js";

setUpEachTest();

describe("startCheckProblems", () => {
  it("passes a session listing exactly its skills from its own plugin", async () => {
    await expect(startCheckProblems(anEngine(), skills, paths)).resolves.toEqual([]);
  });

  it("refuses a reload the engine held", async () => {
    await expect(startCheckProblems(anEngine({ held: true }), skills, paths)).resolves.toEqual([
      "The engine held the plugin reload, which would have changed the cached prompt.",
    ]);
  });

  it("expects no skill at all of a session without skills", async () => {
    const engine = anEngine({ plugins: [], listed: ["deploy"] });

    await expect(startCheckProblems(engine, undefined, paths)).resolves.toEqual([
      "It lists deploy, which it shouldn't have.",
    ]);
  });

  it("takes the folder by another spelling of its path as the same", async () => {
    const engine = anEngine({ plugins: [{ name: "office", path: join(folder, ".", "") }] });

    await expect(startCheckProblems(engine, skills, paths)).resolves.toEqual([]);
  });
});

function init(fields: Partial<SDKSystemMessage>): SDKSystemMessage {
  return fields as SDKSystemMessage;
}

describe("initProblems", () => {
  it("passes an init with its plugin and no errors", async () => {
    await expect(
      initProblems(
        init({ plugins: [{ name: "office", path: folder }], plugin_errors: [] }),
        skills,
        paths,
      ),
    ).resolves.toEqual([]);
  });

  it("names what disagrees with the start check", async () => {
    const message = init({
      plugins: [],
      plugin_errors: [{ plugin: "office", type: "manifest" }] as SDKSystemMessage["plugin_errors"],
    });

    await expect(initProblems(message, skills, paths)).resolves.toEqual([
      "The engine reports a plugin error.",
      `The engine didn't load its skills folder ${folder} as the office plugin.`,
    ]);
  });
});

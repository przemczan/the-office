import { describe, expect, it } from "vitest";
import { FIRST_CLAUDE_CODE_ENGINE } from "../../engine/index.js";
import { engineTypeOptions } from "./engine-type-offers.js";

const claudeCode = engineTypeOptions([FIRST_CLAUDE_CODE_ENGINE]).find(
  ({ type }) => type === "claude-code",
);

describe("engineTypeOptions", () => {
  it("offers a listed type's models, each on every account while one engine lists them", () => {
    expect(claudeCode).toEqual({
      type: "claude-code",
      listed: true,
      models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"].map((model) => ({
        model,
        onEveryAccount: true,
      })),
      efforts: ["low", "medium", "high", "xhigh", "max"],
    });
  });

  it("marks a model only some of the type's engines offer as not on every account", () => {
    const second = {
      ...FIRST_CLAUDE_CODE_ENGINE,
      id: "second-claude-code",
      listedModels: ["claude-sonnet-5-5"],
    };

    const [options] = engineTypeOptions([FIRST_CLAUDE_CODE_ENGINE, second]);

    expect(options?.models).toEqual([
      { model: "claude-opus-5-5", onEveryAccount: false },
      { model: "claude-sonnet-5-5", onEveryAccount: true },
      { model: "claude-haiku-5-5", onEveryAccount: false },
    ]);
  });

  it("lists the types no engine lists after the listed ones, offering no model", () => {
    const types = engineTypeOptions([FIRST_CLAUDE_CODE_ENGINE]);

    expect(types[0]?.type).toBe("claude-code");
    expect(types.slice(1)).toContainEqual(
      expect.objectContaining({ type: "codex", listed: false, models: [] }),
    );
  });
});

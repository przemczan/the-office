import { describe, expect, it } from "vitest";
import { listedClaudeModels } from "./listed-models.js";

describe("listedClaudeModels", () => {
  it("names each model by its full id, resolved from an alias, once each in the account's order", () => {
    expect(
      listedClaudeModels([
        { value: "default", resolvedModel: "claude-opus-5-5" },
        { value: "sonnet", resolvedModel: "claude-sonnet-5-5" },
        { value: "claude-opus-5-5" },
        { value: "claude-haiku-5-5[1m]" },
        { value: "opusplan" },
        { value: "haiku", resolvedModel: "claude-haiku-5-5" },
      ]),
    ).toEqual(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
  });

  it("answers undefined when the account lists no Claude model id", () => {
    expect(listedClaudeModels([])).toBeUndefined();
    expect(listedClaudeModels(undefined)).toBeUndefined();
    expect(listedClaudeModels([{ value: "opusplan" }])).toBeUndefined();
  });
});

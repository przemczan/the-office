import { describe, expect, it } from "vitest";
import { apiEndpointModel, apiEndpointModels, parseApiEndpointModel } from "./api-endpoints.js";
import type { ApiEngine } from "./engines.js";

const strata: ApiEngine = {
  id: "strata",
  name: "Strata",
  kind: "openai-compatible-api",
  defaultModel: "qwen3.8-flash",
  baseUrl: "http://127.0.0.1:8080/v1",
  key: "",
  models: [
    { id: "qwen3.8-flash", contextWindow: 100_000 },
    { id: "org/coder:q4", contextWindow: 32_000 },
  ],
};

describe("a Role's Model field on an API endpoint", () => {
  it("names the endpoint and the model, and is read back whatever the model's id holds", () => {
    const model = apiEndpointModel("strata", "org/coder:q4");

    expect(model).toBe("strata/org/coder:q4");
    expect(parseApiEndpointModel(model)).toEqual({
      endpointId: "strata",
      modelId: "org/coder:q4",
    });
  });

  it.each(["claude-opus-5-5", "/qwen", "strata/"])("names no endpoint in %j", (model) => {
    expect(parseApiEndpointModel(model)).toBeUndefined();
  });

  it("lists every endpoint's models in their order", () => {
    const local: ApiEngine = { ...strata, id: "local", models: [strata.models[0]!] };

    expect(apiEndpointModels([strata, local])).toEqual([
      "strata/qwen3.8-flash",
      "strata/org/coder:q4",
      "local/qwen3.8-flash",
    ]);
  });
});

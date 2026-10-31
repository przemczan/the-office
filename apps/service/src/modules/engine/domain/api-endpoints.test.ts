import { describe, expect, it } from "vitest";
import {
  apiEndpointIdFor,
  apiEndpointModel,
  apiEndpointModels,
  parseApiEndpointModel,
  type ApiEndpoint,
} from "./api-endpoints.js";

const strata: ApiEndpoint = {
  id: "strata",
  name: "Strata",
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
    const local: ApiEndpoint = { ...strata, id: "local", models: [strata.models[0]!] };

    expect(apiEndpointModels([strata, local])).toEqual([
      "strata/qwen3.8-flash",
      "strata/org/coder:q4",
      "local/qwen3.8-flash",
    ]);
  });
});

describe("apiEndpointIdFor", () => {
  it("keeps the name's letters and digits, joined by dashes", () => {
    expect(apiEndpointIdFor(" Strata · Büro 2 ", new Set())).toBe("strata-buro-2");
  });

  it("numbers an id that is taken", () => {
    expect(apiEndpointIdFor("Strata", new Set(["strata", "strata-2"]))).toBe("strata-3");
  });

  it("is empty for a name without letters or digits", () => {
    expect(apiEndpointIdFor("!!!", new Set())).toBe("");
  });
});

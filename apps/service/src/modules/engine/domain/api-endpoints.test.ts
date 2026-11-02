import { describe, expect, it } from "vitest";
import { apiEndpointModel, parseApiEndpointModel } from "./api-endpoints.js";

describe("an API endpoint's model as the API adapter is handed it", () => {
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
});

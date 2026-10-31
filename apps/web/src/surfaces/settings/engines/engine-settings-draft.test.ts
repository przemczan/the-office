import { describe, expect, it } from "vitest";
import { draftOf, keyOnSave, searchEndpointOf } from "./engine-settings-draft.ts";

const STRATA = {
  id: "strata",
  name: "Strata",
  baseUrl: "http://127.0.0.1:8080/v1",
  keySet: true,
  models: [{ id: "qwen3", contextWindow: 100_000 }],
};

describe("Settings › Engines' draft", () => {
  it("starts from the saved settings with every key kept", () => {
    expect(draftOf({ apiEndpoints: [STRATA], searchEndpoint: null })).toEqual({
      apiEndpoints: [
        {
          id: "strata",
          name: "Strata",
          baseUrl: "http://127.0.0.1:8080/v1",
          models: [{ id: "qwen3", contextWindow: 100_000 }],
        },
      ],
      searchEndpoint: null,
    });
  });

  it("says what Save does with a key: kept, new, or removed", () => {
    const edit = { name: "Strata", baseUrl: "", models: [] };

    expect(keyOnSave(edit, STRATA)).toBe("kept-set");
    expect(keyOnSave(edit, { ...STRATA, keySet: false })).toBe("kept-none");
    expect(keyOnSave({ ...edit, key: "sk-new" }, STRATA)).toBe("new");
    expect(keyOnSave({ ...edit, key: "" }, STRATA)).toBe("removed");
    expect(keyOnSave({ ...edit, key: "" }, undefined)).toBe("kept-none");
  });

  it("has no Search endpoint while its base URL is empty", () => {
    expect(searchEndpointOf("  ")).toBeNull();
    expect(searchEndpointOf("http://searxng ")).toEqual({ baseUrl: "http://searxng" });
  });
});

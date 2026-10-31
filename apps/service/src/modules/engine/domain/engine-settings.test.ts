import { describe, expect, it } from "vitest";
import type { ApiEndpoint } from "./api-endpoints.js";
import {
  changedEngineSettings,
  DEFAULT_ENGINE_SETTINGS,
  type ApiEndpointEdit,
  type EngineSettings,
} from "./engine-settings.js";
import { EngineSettingsRefused } from "./engine-settings-refused.js";

const strata: ApiEndpoint = {
  id: "strata",
  name: "Strata",
  baseUrl: "http://127.0.0.1:8080/v1",
  key: "sk-strata",
  models: [{ id: "qwen3.8-flash", contextWindow: 100_000 }],
};
const stored: EngineSettings = { apiEndpoints: [strata], searchEndpoint: null };

function anEdit(fields: Partial<ApiEndpointEdit> = {}): ApiEndpointEdit {
  const { key: _key, ...endpoint } = strata;
  return { ...endpoint, ...fields };
}

function refusal(settings: EngineSettings, apiEndpoints: readonly ApiEndpointEdit[]): unknown {
  try {
    changedEngineSettings(settings, { apiEndpoints, searchEndpoint: null });
  } catch (error) {
    if (error instanceof EngineSettingsRefused) return error.reasons;
    throw error;
  }
  throw new Error("The settings were kept.");
}

describe("changedEngineSettings", () => {
  it("gives a new API endpoint an id made from its name, apart from the ones listed", () => {
    const changed = changedEngineSettings(stored, {
      apiEndpoints: [
        anEdit({ name: "Old Strata" }),
        anEdit({ id: undefined, name: " Strata ", key: " sk-new " }),
      ],
      searchEndpoint: { baseUrl: " http://127.0.0.1:8888 " },
    });

    expect(changed).toEqual({
      apiEndpoints: [
        { ...strata, name: "Old Strata" },
        { ...strata, id: "strata-2", key: "sk-new" },
      ],
      searchEndpoint: { baseUrl: "http://127.0.0.1:8888" },
    });
  });

  it("keeps an endpoint's id and key when it is renamed, and clears the key when it is empty", () => {
    const renamed = changedEngineSettings(stored, {
      apiEndpoints: [anEdit({ name: "Strata box" })],
      searchEndpoint: null,
    });
    const cleared = changedEngineSettings(stored, {
      apiEndpoints: [anEdit({ key: "" })],
      searchEndpoint: null,
    });

    expect(renamed.apiEndpoints).toEqual([{ ...strata, name: "Strata box" }]);
    expect(cleared.apiEndpoints).toEqual([{ ...strata, key: "" }]);
  });

  it("removes the endpoints left out", () => {
    expect(changedEngineSettings(stored, DEFAULT_ENGINE_SETTINGS)).toEqual(DEFAULT_ENGINE_SETTINGS);
  });

  it("refuses with every reason", () => {
    expect(
      refusal(stored, [
        anEdit({ name: "", baseUrl: "ftp://strata" }),
        anEdit({ id: undefined, name: "!!!", models: [] }),
        anEdit({
          id: undefined,
          name: "Local",
          models: [
            { id: "qwen", contextWindow: 1_000 },
            { id: " qwen ", contextWindow: 0.5 },
            { id: "", contextWindow: 1_000 },
          ],
        }),
        anEdit({ id: undefined, name: "local" }),
        anEdit({ id: undefined, name: "N".repeat(41) }),
      ]),
    ).toEqual([
      "Give each API endpoint a name.",
      "Give the API endpoint a base URL starting with http:// or https://.",
      'Give "!!!" a name with letters or digits.',
      'Give "!!!" at least one model.',
      '"Local" lists the model "qwen" twice.',
      'Give each model of "Local" its context window, in tokens.',
      'Give each model of "Local" its id.',
      "An API endpoint's name may be at most 40 characters.",
      'Two API endpoints are called "local".',
    ]);
  });

  it("refuses an endpoint removed meanwhile, or listed twice", () => {
    const reason = "The API endpoints changed meanwhile; open Settings › Engines again.";

    expect(refusal(DEFAULT_ENGINE_SETTINGS, [anEdit()])).toEqual([reason]);
    expect(refusal(stored, [anEdit(), anEdit({ name: "Again" })])).toEqual([reason]);
  });

  it("refuses a search endpoint that isn't a web address", () => {
    expect(() =>
      changedEngineSettings(stored, {
        apiEndpoints: [],
        searchEndpoint: { baseUrl: "searxng" },
      }),
    ).toThrow(
      new EngineSettingsRefused([
        "Give the search endpoint a base URL starting with http:// or https://.",
      ]),
    );
  });
});

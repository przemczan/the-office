import { describe, expect, it } from "vitest";
import { codex } from "../domain/engine-settings.fixtures.js";
import { FIRST_CLAUDE_CODE_ENGINE } from "../domain/engines.js";
import { EngineSettingsForTests } from "../ports/engine-settings-repository.fixtures.js";
import { EngineModels } from "./engine-models.js";

describe("EngineModels.officeDefault", () => {
  it("gives the Office default's engine on its default model", async () => {
    const models = new EngineModels(
      new EngineSettingsForTests({
        engines: [FIRST_CLAUDE_CODE_ENGINE, { ...codex, defaultModel: "gpt-5.6-terra" }],
        officeDefault: { engineType: "codex", engineId: "codex" },
      }),
    );

    await expect(models.officeDefault()).resolves.toEqual({
      engineId: "codex",
      model: "gpt-5.6-terra",
    });
  });

  it("gives none while no engine is listed", async () => {
    const models = new EngineModels(
      new EngineSettingsForTests({ engines: [], officeDefault: null }),
    );

    await expect(models.officeDefault()).resolves.toBeNull();
  });
});

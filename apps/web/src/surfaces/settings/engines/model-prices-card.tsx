import type { ApiEndpoint, EngineId } from "@the-office/contracts";
import { Card, Input } from "@the-office/ui";
import type { ReactNode } from "react";
import { modelLabel } from "../../../shell/engine-words.ts";
import { SettingsCardTitle } from "../settings-card-parts.tsx";
import type { PricedModel } from "./engine-settings-draft.ts";
import {
  PRICE_KIND_LABELS,
  PRICE_KINDS,
  priceFieldProblem,
  type ModelPriceText,
} from "./model-price-fields.ts";

const ENGINE_ID_LABELS: Readonly<Record<EngineId, string>> = {
  "claude-code": "Claude Code engines",
  "openai-compatible-api": "OpenAI-compatible API",
};

/** Settings › Engines' Model prices: four price fields for each model offered in the draft. */
export function ModelPricesCard({
  offered,
  apiEndpoints,
  priceTextOf,
  change,
}: {
  readonly offered: readonly PricedModel[];
  /** The drafted API endpoints with their ids, so their models read by name. */
  readonly apiEndpoints: readonly Pick<ApiEndpoint, "id" | "name">[];
  readonly priceTextOf: (model: PricedModel) => ModelPriceText;
  readonly change: (model: PricedModel, text: ModelPriceText) => void;
}): ReactNode {
  return (
    <Card title={<SettingsCardTitle icon="coins">Model prices</SettingsCardTitle>}>
      <p className="settings-note">
        What each model costs, in dollars per million tokens. Every cost in The Office is priced by
        them. A model left without one has no cost, which never holds a Start.
      </p>
      {(Object.keys(ENGINE_ID_LABELS) as EngineId[]).map((engineId) => {
        const models = offered.filter((model) => model.engineId === engineId);
        return (
          <section key={engineId} className="model-prices" aria-label={ENGINE_ID_LABELS[engineId]}>
            <h3 className="model-prices-engine">{ENGINE_ID_LABELS[engineId]}</h3>
            {models.length === 0 && engineId === "openai-compatible-api" && (
              <p className="settings-note">No API endpoint offers a model yet.</p>
            )}
            {models.map((model) => (
              <ModelPriceFields
                key={model.model}
                label={modelLabel(model.model, apiEndpoints)}
                text={priceTextOf(model)}
                change={(text) => change(model, text)}
              />
            ))}
          </section>
        );
      })}
    </Card>
  );
}

function ModelPriceFields({
  label,
  text,
  change,
}: {
  readonly label: string;
  readonly text: ModelPriceText;
  readonly change: (text: ModelPriceText) => void;
}): ReactNode {
  return (
    <fieldset className="model-price" aria-label={`Model price of ${label}`}>
      <span className="model-price-model">{label}</span>
      {PRICE_KINDS.map((kind) => (
        <Input
          key={kind}
          label={PRICE_KIND_LABELS[kind]}
          inputMode="decimal"
          suffix="$ / M"
          value={text[kind]}
          error={priceFieldProblem(text, kind)}
          onChange={(event) => change({ ...text, [kind]: event.target.value })}
        />
      ))}
    </fieldset>
  );
}

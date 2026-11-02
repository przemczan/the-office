import { Card, Input } from "@the-office/ui";
import type { ReactNode } from "react";
import { modelLabel } from "../../../shell/engine-words.ts";
import { SettingsCardTitle } from "../settings-card-parts.tsx";
import type { DraftedEndpoint, PricedModel } from "./engine-settings-draft.ts";
import {
  PRICE_KIND_LABELS,
  PRICE_KINDS,
  priceFieldProblem,
  type ModelPriceText,
} from "./model-price-fields.ts";

/** Settings › Engines' Model prices: four price fields for each model offered in the draft. */
export function ModelPricesCard({
  offered,
  apiEndpoints,
  priceTextOf,
  change,
}: {
  readonly offered: readonly PricedModel[];
  /** The drafted API endpoints with their ids, so their models read by name. */
  readonly apiEndpoints: readonly Pick<DraftedEndpoint, "id" | "name">[];
  readonly priceTextOf: (model: PricedModel) => ModelPriceText;
  readonly change: (model: PricedModel, text: ModelPriceText) => void;
}): ReactNode {
  return (
    <Card title={<SettingsCardTitle icon="coins">Model prices</SettingsCardTitle>}>
      <p className="settings-note">
        What each model costs, in dollars per million tokens. Every cost in The Office is priced by
        them. A model left without one has no cost, which never holds a Start.
      </p>
      <ModelPricesOf
        title="Claude Code engines"
        models={offered.filter(({ engineId }) => engineId === null)}
        labelOf={(model) => modelLabel(model)}
        priceTextOf={priceTextOf}
        change={change}
      />
      {apiEndpoints
        .filter(({ id }) => id !== "")
        .map(({ id, name }) => (
          <ModelPricesOf
            key={id}
            title={name}
            models={offered.filter(({ engineId }) => engineId === id)}
            labelOf={(model) => `${name} · ${model}`}
            priceTextOf={priceTextOf}
            change={change}
          />
        ))}
      {!offered.some(({ engineId }) => engineId !== null) && (
        <p className="settings-note">No API endpoint offers a model yet.</p>
      )}
    </Card>
  );
}

/** The price fields of the models priced under one engine id, or the Claude models'. */
function ModelPricesOf({
  title,
  models,
  labelOf,
  priceTextOf,
  change,
}: {
  readonly title: string;
  readonly models: readonly PricedModel[];
  readonly labelOf: (model: string) => string;
  readonly priceTextOf: (model: PricedModel) => ModelPriceText;
  readonly change: (model: PricedModel, text: ModelPriceText) => void;
}): ReactNode {
  if (models.length === 0) return null;
  return (
    <section className="model-prices" aria-label={title}>
      <h3 className="model-prices-engine">{title}</h3>
      {models.map((model) => (
        <ModelPriceFields
          key={model.model}
          label={labelOf(model.model)}
          text={priceTextOf(model)}
          change={(text) => change(model, text)}
        />
      ))}
    </section>
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

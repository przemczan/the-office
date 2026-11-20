import type { ApiEndpointModel, ApiEngineEdit, EngineId } from "@the-office/contracts";
import { Button, Checkbox, Icon, IconButton, Input } from "@the-office/ui";
import type { ReactNode } from "react";
import { modelLabel } from "../../../shell/engine-words.ts";
import type { PricedModel } from "./engine-settings-draft.ts";
import {
  PRICE_KIND_LABELS,
  PRICE_KINDS,
  priceFieldProblem,
  type ModelPriceText,
} from "./model-price-fields.ts";

/** How an engine's Models and prices reads and changes the draft's Model prices. */
export interface PriceFields {
  readonly priceTextOf: (model: PricedModel) => ModelPriceText;
  readonly change: (model: PricedModel, text: ModelPriceText) => void;
}

function PricesNote(): ReactNode {
  return (
    <p className="settings-note">
      What each model costs, in dollars per million tokens. Every cost in The Office is priced by
      them. A model left without one has no cost, which never holds a Start.
    </p>
  );
}

/**
 * A Claude Code engine's Models and prices: the Claude models' prices, kept once (engine id null)
 * and so shared by every Claude Code engine.
 */
export function ClaudeModelPrices({
  models,
  prices,
}: {
  readonly models: readonly PricedModel[];
  readonly prices: PriceFields;
}): ReactNode {
  return (
    <SharedModelPrices
      models={models}
      prices={prices}
      shared="The Claude models' prices are shared by every Claude Code engine: a change here is a change for all of them."
    />
  );
}

/**
 * A Codex engine's Models and prices: the Codex models' prices, kept once (engine id null) and so
 * shared by every Codex engine.
 */
export function CodexModelPrices({
  models,
  prices,
}: {
  readonly models: readonly PricedModel[];
  readonly prices: PriceFields;
}): ReactNode {
  return (
    <SharedModelPrices
      models={models}
      prices={prices}
      shared="The Codex models' prices are shared by every Codex engine: a change here is a change for all of them."
    />
  );
}

/**
 * A Copilot CLI or Gemini CLI engine's Models and prices: its models priced on the engine itself,
 * as an API endpoint's are, so a new engine's wait for its name.
 */
export function PerEngineModelPrices({
  models,
  called,
  prices,
}: {
  readonly models: readonly PricedModel[];
  readonly called: string;
  readonly prices: PriceFields;
}): ReactNode {
  return (
    <div className="engine-tab">
      <PricesNote />
      {models.length === 0 && (
        <p className="settings-note">Give the engine a name under Settings to price its models.</p>
      )}
      <div className="engine-prices" role="group" aria-label={`Models of ${called}`}>
        {models.map((model) => (
          <ModelPriceFields
            key={model.model}
            label={modelLabel(model.model)}
            text={prices.priceTextOf(model)}
            change={(text) => prices.change(model, text)}
          />
        ))}
      </div>
    </div>
  );
}

function SharedModelPrices({
  models,
  prices,
  shared,
}: {
  readonly models: readonly PricedModel[];
  readonly prices: PriceFields;
  /** Which engines share them. */
  readonly shared: string;
}): ReactNode {
  return (
    <div className="engine-tab">
      <PricesNote />
      <p className="settings-note">{shared}</p>
      <div className="engine-prices">
        {models.map((model) => (
          <ModelPriceFields
            key={model.model}
            label={modelLabel(model.model)}
            text={prices.priceTextOf(model)}
            change={(text) => prices.change(model, text)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * An API endpoint's Models and prices: each model with its context window and its four prices,
 * priced by the id Save gives the endpoint, so a new one's prices wait for its name.
 */
export function ApiEndpointModels({
  edit,
  engineId,
  called,
  change,
  prices,
}: {
  readonly edit: ApiEngineEdit;
  /** The id Save gives the endpoint: empty while it has no name. */
  readonly engineId: EngineId;
  readonly called: string;
  readonly change: (edit: ApiEngineEdit) => void;
  readonly prices: PriceFields;
}): ReactNode {
  const changeModel = (index: number, model: ApiEndpointModel): void =>
    change({ ...edit, models: edit.models.map((kept, at) => (at === index ? model : kept)) });
  return (
    <div className="engine-tab">
      <PricesNote />
      <p className="settings-note">
        Each model by its id on the server. Tick Sees images for a model that reads pictures: the
        images pasted into a message reach it; any other is told of each image in words.
      </p>
      {engineId === "" && (
        <p className="settings-note">
          Give the endpoint a name under Settings to price its models.
        </p>
      )}
      <div className="api-endpoint-models" role="group" aria-label={`Models of ${called}`}>
        {edit.models.map((model, index) => {
          const priced: PricedModel = { engineId, model: model.id.trim() };
          return (
            // A model's id is what the user edits, so its place is its identity.
            <div key={index} className="api-endpoint-model">
              <div className="api-endpoint-model-head">
                <Input
                  label="Model"
                  value={model.id}
                  onChange={(event) => changeModel(index, { ...model, id: event.target.value })}
                />
                <Input
                  label="Context window"
                  inputMode="numeric"
                  suffix="tokens"
                  value={model.contextWindow === 0 ? "" : String(model.contextWindow)}
                  onChange={(event) =>
                    changeModel(index, { ...model, contextWindow: Number(event.target.value) || 0 })
                  }
                />
                <div className="api-endpoint-model-sees-images">
                  <Checkbox
                    checked={model.seesImages}
                    onChange={(seesImages) => changeModel(index, { ...model, seesImages })}
                    label="Sees images"
                  />
                </div>
                <IconButton
                  size="sm"
                  icon={<Icon name="x" size={14} />}
                  label={`Remove the model ${model.id || "without an id"}`}
                  onClick={() =>
                    change({ ...edit, models: edit.models.filter((_model, at) => at !== index) })
                  }
                />
              </div>
              {engineId !== "" && priced.model !== "" && (
                <ModelPriceFields
                  label={`${edit.name.trim()} · ${priced.model}`}
                  caption="Its price"
                  text={prices.priceTextOf(priced)}
                  change={(text) => prices.change(priced, text)}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="engine-tab-actions">
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<Icon name="plus" size={14} />}
          onClick={() =>
            change({
              ...edit,
              models: [...edit.models, { id: "", contextWindow: 0, seesImages: false }],
            })
          }
        >
          Add a model
        </Button>
      </div>
    </div>
  );
}

/** A model's four prices, all four or none. */
function ModelPriceFields({
  label,
  caption = label,
  text,
  change,
}: {
  readonly label: string;
  /** What the row shows before its fields: the model's label, unless the row sits under it. */
  readonly caption?: string;
  readonly text: ModelPriceText;
  readonly change: (text: ModelPriceText) => void;
}): ReactNode {
  return (
    <fieldset className="model-price" aria-label={`Model price of ${label}`}>
      <span className="model-price-model">{caption}</span>
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

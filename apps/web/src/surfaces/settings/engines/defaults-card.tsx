import type { EngineModel, SearchEndpoint } from "@the-office/contracts";
import { Card, Input, Select } from "@the-office/ui";
import type { ReactNode } from "react";
import { modelLabel } from "../../../shell/engine-words.ts";
import { SettingsCardTitle } from "../settings-card-parts.tsx";
import { searchEndpointOf, type OfficeDefaultChoice } from "./engine-settings-draft.ts";

/**
 * Settings › Engines' Defaults: the Office default, an engine and one of its models, picking an
 * engine filling in its default model (none while no engine is listed, until the first one saved
 * takes it), beside the Search endpoint.
 */
export function DefaultsCard({
  officeDefault,
  choices,
  searchEndpoint,
  changeOfficeDefault,
  changeSearchEndpoint,
}: {
  readonly officeDefault: EngineModel | null;
  readonly choices: readonly OfficeDefaultChoice[];
  readonly searchEndpoint: SearchEndpoint | null;
  readonly changeOfficeDefault: (officeDefault: EngineModel) => void;
  readonly changeSearchEndpoint: (searchEndpoint: SearchEndpoint | null) => void;
}): ReactNode {
  return (
    <Card title={<SettingsCardTitle icon="sliders-horizontal">Defaults</SettingsCardTitle>}>
      <div className="engine-defaults">
        <section className="engine-default" aria-labelledby="engine-defaults-office">
          <h3 id="engine-defaults-office" className="engine-default-title">
            Office default
          </h3>
          {officeDefault ? (
            <OfficeDefaultFields
              officeDefault={officeDefault}
              choices={choices}
              change={changeOfficeDefault}
            />
          ) : (
            <p className="settings-note">
              No engine is listed, so no session starts. The first engine saved becomes the Office
              default, on its default model.
            </p>
          )}
          <p className="settings-note">
            What every session runs on unless something more specific names another. A new engine
            can be picked once saved.
          </p>
        </section>
        <section className="engine-default" aria-labelledby="engine-defaults-search">
          <h3 id="engine-defaults-search" className="engine-default-title">
            Search endpoint
          </h3>
          <Input
            label="Base URL"
            hint="SearXNG, with json among its search formats. WebSearch on the OpenAI-compatible API goes through it, and is refused while none is set."
            placeholder="http://127.0.0.1:8888"
            value={searchEndpoint?.baseUrl ?? ""}
            onChange={(event) => changeSearchEndpoint(searchEndpointOf(event.target.value))}
          />
        </section>
      </div>
    </Card>
  );
}

function OfficeDefaultFields({
  officeDefault,
  choices,
  change,
}: {
  readonly officeDefault: EngineModel;
  readonly choices: readonly OfficeDefaultChoice[];
  readonly change: (officeDefault: EngineModel) => void;
}): ReactNode {
  const engine = choices.find(({ id }) => id === officeDefault.engineId);
  return (
    <div className="engine-default-fields" role="group" aria-label="Office default">
      <Select
        label="Engine"
        options={choices.map(({ id, name }) => ({ value: id, label: name }))}
        value={officeDefault.engineId}
        onChange={(engineId) =>
          change({
            engineId,
            model: choices.find(({ id }) => id === engineId)?.defaultModel ?? "",
          })
        }
      />
      <Select
        label="Model"
        options={(engine?.models ?? []).map((model) => ({
          value: model,
          label: modelLabel(model),
        }))}
        value={officeDefault.model}
        onChange={(model) => change({ ...officeDefault, model })}
      />
    </div>
  );
}

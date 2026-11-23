import type { EngineKind, OfficeDefault, SearchEndpoint } from "@the-office/contracts";
import { Card, Input } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  EngineTypeAccountFields,
  type EngineTypeChoice,
} from "../../../shell/engine-type-account-fields.tsx";
import { SettingsCardTitle } from "../settings-card-parts.tsx";
import { searchEndpointOf } from "./engine-settings-draft.ts";

/** What the Office default is for, under its two fields. */
export const OFFICE_DEFAULT_HINT =
  "Where every session runs unless a Project, an Initiative or a Task sets another. How each person works there comes from their Role card.";

/**
 * Settings › Engines' Defaults: the Office default, an engine type and one of its accounts, picking
 * a type picking its first account (none while no engine is saved, until the first one saved
 * takes it), beside the Search endpoint.
 */
export function DefaultsCard({
  officeDefault,
  choices,
  searchEndpoint,
  changeOfficeDefault,
  changeOfficeDefaultType,
  changeSearchEndpoint,
}: {
  readonly officeDefault: OfficeDefault | null;
  readonly choices: readonly EngineTypeChoice[];
  readonly searchEndpoint: SearchEndpoint | null;
  readonly changeOfficeDefault: (officeDefault: OfficeDefault) => void;
  readonly changeOfficeDefaultType: (engineType: EngineKind) => void;
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
            <EngineTypeAccountFields
              name="Office default"
              value={officeDefault}
              choices={choices}
              hint={OFFICE_DEFAULT_HINT}
              onChange={(picked) =>
                picked.engineType === officeDefault.engineType
                  ? changeOfficeDefault(picked)
                  : changeOfficeDefaultType(picked.engineType)
              }
            />
          ) : (
            <p className="settings-note">
              No engine is listed, so no session starts. The first engine saved becomes the Office
              default.
            </p>
          )}
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

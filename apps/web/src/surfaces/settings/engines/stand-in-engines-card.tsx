import type { EngineId } from "@the-office/contracts";
import { Card, Icon, IconButton, Input, Select } from "@the-office/ui";
import type { ReactNode } from "react";
import { SettingsCardTitle } from "../settings-card-parts.tsx";
import {
  switchSizeProblem,
  withStandInMoved,
  type StandInChoice,
} from "./engine-settings-draft.ts";

/**
 * Settings › Engines' Stand-in Engines: the Office-wide ordered list of engines that take over for
 * one whose 5-hour or 7-day usage window is used up, "Add a stand-in" over the saved engines not
 * listed yet, and the context size above which switching a running Stage asks first.
 */
export function StandInEnginesCard({
  listed,
  addable,
  askBeforeSwitchAbove,
  changeStandInEngines,
  changeAskBeforeSwitchAbove,
}: {
  readonly listed: readonly StandInChoice[];
  readonly addable: readonly StandInChoice[];
  readonly askBeforeSwitchAbove: string;
  readonly changeStandInEngines: (standInEngines: readonly EngineId[]) => void;
  readonly changeAskBeforeSwitchAbove: (text: string) => void;
}): ReactNode {
  const ids = listed.map(({ id }) => id);
  return (
    <Card title={<SettingsCardTitle icon="replace">Stand-in Engines</SettingsCardTitle>}>
      <div className="stand-in-engines">
        <p className="settings-note">
          When an engine runs out of its 5-hour or 7-day usage window, a Stand-in Engine takes over
          its work, tried in this order. A switch keeps the model, so only an engine serving the
          same model takes over.
        </p>
        {listed.length > 0 ? (
          <ol className="stand-in-engine-rows" aria-label="Stand-in Engines">
            {listed.map(({ id, name }, index) => (
              <li key={id} className="stand-in-engine-row">
                <span className="stand-in-engine-place">{index + 1}</span>
                <span className="stand-in-engine-name">{name}</span>
                <span className="stand-in-engine-tools">
                  <IconButton
                    size="sm"
                    icon={<Icon name="chevron-up" size={14} />}
                    label={`Move ${name} up`}
                    title={index === 0 ? `${name} is first already` : `Move ${name} up`}
                    disabled={index === 0}
                    onClick={() => changeStandInEngines(withStandInMoved(ids, index, -1))}
                  />
                  <IconButton
                    size="sm"
                    icon={<Icon name="chevron-down" size={14} />}
                    label={`Move ${name} down`}
                    title={
                      index === listed.length - 1 ? `${name} is last already` : `Move ${name} down`
                    }
                    disabled={index === listed.length - 1}
                    onClick={() => changeStandInEngines(withStandInMoved(ids, index, 1))}
                  />
                  <IconButton
                    size="sm"
                    icon={<Icon name="x" size={14} />}
                    label={`Remove ${name} from the Stand-in Engines`}
                    onClick={() => changeStandInEngines(ids.filter((listedId) => listedId !== id))}
                  />
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="settings-note">
            No Stand-in Engine yet, so work waits for its own engine's usage window to free up. Add
            one with "Add a stand-in".
          </p>
        )}
        <div className="stand-in-engine-fields">
          <Select
            label="Add a stand-in"
            placeholder={
              addable.length > 0 ? "Pick a saved engine" : "Every saved engine is listed"
            }
            hint={
              addable.length > 0
                ? "A new engine can be added once saved."
                : "Every saved engine is listed already. A new engine can be added once saved."
            }
            disabled={addable.length === 0}
            options={addable.map(({ id, name }) => ({ value: id, label: name }))}
            value=""
            onChange={(id) => id !== "" && changeStandInEngines([...ids, id])}
          />
          <Input
            label="Ask before switching a Stage whose context is over"
            hint="Above this size a switch of a running Stage waits for your answer; 0 always asks."
            inputMode="numeric"
            suffix="tokens"
            value={askBeforeSwitchAbove}
            error={switchSizeProblem(askBeforeSwitchAbove)}
            onChange={(event) => changeAskBeforeSwitchAbove(event.target.value)}
          />
        </div>
      </div>
    </Card>
  );
}

import type { EngineId } from "@the-office/contracts";
import { Card, Input } from "@the-office/ui";
import type { ReactNode } from "react";
import { AddStandIn, StandInEngineRows } from "../../../shell/stand-in-engine-rows.tsx";
import { SettingsCardTitle } from "../settings-card-parts.tsx";
import { switchSizeProblem, type StandInChoice } from "./engine-settings-draft.ts";

/** The card's note on stand-ins of another engine type (screens/settings.md "Engines"). */
export const STAND_IN_ENGINES_NOTE =
  "On another engine type, a Thread or a new session starts fresh with each person's model and effort for it; a running Stage waits for the reset instead. A Project can use a list of its own.";
export const NO_STAND_IN_ENGINE_YET =
  "No Stand-in Engine yet, so work waits for its own engine's usage window to free up.";

/**
 * Settings › Engines' Stand-in Engines: the Office-wide ordered list of engines that take over for
 * one whose 5-hour or 7-day usage window is used up, of any engine type, in the shell's rows, "Add a
 * stand-in" over the saved engines not listed yet, and the context size above which switching a
 * running Stage asks first.
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
        <p className="settings-note">{STAND_IN_ENGINES_NOTE}</p>
        <StandInEngineRows
          rows={listed}
          empty={NO_STAND_IN_ENGINE_YET}
          onChange={changeStandInEngines}
        />
        <div className="stand-in-engine-fields">
          <AddStandIn
            addable={addable}
            hint={
              addable.length > 0
                ? "A new engine can be added once saved."
                : "Every saved engine is listed already. A new engine can be added once saved."
            }
            onAdd={(id) => changeStandInEngines([...ids, id])}
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

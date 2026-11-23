import { Link } from "@tanstack/react-router";
import type {
  Engine,
  EngineId,
  EngineKind,
  EngineSettings,
  ProjectStandIns,
} from "@the-office/contracts";
import { Switch } from "@the-office/ui";
import type { ReactNode } from "react";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import {
  AddStandIn,
  StandInEngineRows,
  type StandInEngineRow,
} from "../../shell/stand-in-engine-rows.tsx";
import { EngineGroup } from "./engine-people.tsx";
import {
  ANOTHER_ENGINE_TYPE_NOTE,
  FROM_SETTINGS_ENGINES,
  OFFICE_HAS_NO_STAND_IN,
  STAND_IN_ENGINES,
  STAND_IN_ENGINES_NOTE,
  USE_OWN_LIST,
  noStandInWords,
} from "./project-engine-words.ts";

/** The listed engines as rows, by name and type; one no longer listed by its id. */
function rowsOf(
  ids: readonly EngineId[],
  engines: readonly Engine[],
  noteFor: (kind: EngineKind | null) => string | null,
): readonly StandInEngineRow[] {
  return ids.map((id) => {
    const engine = engines.find((listed) => listed.id === id);
    const kind = engine?.kind ?? null;
    return { id, name: engine?.name ?? id, kind, note: noteFor(kind) };
  });
}

/**
 * The Engine card's Stand-in Engines (spec 5.4.6 "A Project's own list"; screens/project-page.md
 * "Engine"): off, the Office's list greyed out and read-only under a link to Settings › Engines;
 * on, the Project's own ordered list, a row of another engine type than the Project's noted. Each
 * change sends the whole `standIns`.
 */
export function EngineStandIns({
  projectName,
  standIns,
  settings,
  projectType,
  disabled,
  error,
  onChange,
}: {
  readonly projectName: string;
  readonly standIns: ProjectStandIns;
  readonly settings: EngineSettings | undefined;
  /** The engine type the Project's sessions run on: its own, else the Office default's. */
  readonly projectType: EngineKind | null;
  readonly disabled: boolean;
  readonly error: Error | null;
  readonly onChange: (standIns: ProjectStandIns) => void;
}): ReactNode {
  const { useOwnList, engineIds } = standIns;
  return (
    <EngineGroup title={STAND_IN_ENGINES} note={STAND_IN_ENGINES_NOTE}>
      <Switch
        checked={useOwnList}
        disabled={disabled}
        onChange={(on) => onChange({ useOwnList: on, engineIds })}
        label={USE_OWN_LIST}
      />
      {/* Rows wait for the engines, so none shows by its id, nor the Office's list as empty. */}
      {settings === undefined ? null : useOwnList ? (
        <>
          <StandInEngineRows
            rows={rowsOf(engineIds, settings.engines, (kind) =>
              kind !== null && projectType !== null && kind !== projectType
                ? ANOTHER_ENGINE_TYPE_NOTE
                : null,
            )}
            empty={noStandInWords(projectName)}
            disabled={disabled}
            onChange={(listed) => onChange({ useOwnList, engineIds: [...listed] })}
          />
          <div className="project-engine-add-stand-in">
            <AddStandIn
              addable={settings.engines
                .filter(({ id }) => !engineIds.includes(id))
                .map(({ id, name }) => ({ id, name }))}
              disabled={disabled}
              onAdd={(id) => onChange({ useOwnList, engineIds: [...engineIds, id] })}
            />
          </div>
        </>
      ) : (
        <div className="project-engine-office-stand-ins">
          <p className="project-engine-hint">
            <Link to="/settings/engines">{FROM_SETTINGS_ENGINES}</Link>
          </p>
          <StandInEngineRows
            rows={rowsOf(settings.standInEngines, settings.engines, () => null)}
            empty={OFFICE_HAS_NO_STAND_IN}
            readOnly
          />
        </div>
      )}
      {error && <RefusalAlert title="The Stand-in Engines weren't saved" error={error} />}
    </EngineGroup>
  );
}

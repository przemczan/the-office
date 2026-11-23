import type {
  EngineKind,
  EngineTypeSetting,
  PersonEngineSettings,
  RoleCardOptions,
} from "@the-office/contracts";
import { ENGINE_KIND_LABELS } from "../../shell/engine-words.ts";

/** An engine type as the Role card's Engine group shows it, with the person's setting for it. */
export interface EngineTypeRow {
  readonly type: EngineKind;
  readonly label: string;
  /** Whether Settings › Engines lists an engine of the type. */
  readonly listed: boolean;
  readonly models: RoleCardOptions["engineTypes"][number]["models"];
  readonly efforts: RoleCardOptions["engineTypes"][number]["efforts"];
  /** Undefined while the person sets nothing for the type. */
  readonly setting: EngineTypeSetting | undefined;
}

/**
 * The rows of the Engine group: each engine type with an engine listed, in Settings › Engines'
 * order, then each type the person sets that has none.
 */
export function engineTypeRows(
  { engineTypes }: Pick<RoleCardOptions, "engineTypes">,
  engineSettings: PersonEngineSettings,
): EngineTypeRow[] {
  return engineTypes
    .filter(({ type, listed }) => listed || engineSettings[type] !== undefined)
    .toSorted((first, second) => Number(second.listed) - Number(first.listed))
    .map(({ type, listed, models, efforts }) => ({
      type,
      label: ENGINE_KIND_LABELS[type],
      listed,
      models,
      efforts,
      setting: engineSettings[type],
    }));
}

/** "No Codex engine is listed": a type the person sets with no engine to use it on. */
export function noEngineListedWords(type: EngineKind): string {
  return `No ${ENGINE_KIND_LABELS[type]} engine is listed`;
}

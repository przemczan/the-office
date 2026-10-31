import {
  runPermissionSchema,
  type HardSwitchValue,
  type RunPermission,
  type StagePermissions,
} from "@the-office/contracts";
import type { AgentStage } from "./stage-edits.ts";

/** Changes to a Stage's permissions: an undefined one goes back to the Role card's. */
type PermissionChanges = {
  readonly [Key in keyof StagePermissions]?: StagePermissions[Key] | undefined;
};

/** How much a setting lets through without anyone's say, from Never up, as the service orders it. */
const BREADTH: Readonly<Record<HardSwitchValue["kind"], number>> = {
  never: 0,
  "ask-me": 1,
  consult: 2,
  allowed: 3,
};

/** The run permissions narrower than the card's, from the narrowest: what a Stage may choose. */
export function narrowerRuns(card: RunPermission): RunPermission[] {
  return runPermissionSchema.options.slice(0, runPermissionSchema.options.indexOf(card));
}

/**
 * The settings narrower than the card's for an MCP tool, from the widest: Consulting any of
 * `consultable` under Allowed, then Ask me, then Never. Consulting another Role than the card does
 * isn't narrower, so it is never offered.
 */
export function narrowerSettings(
  card: HardSwitchValue,
  consultable: readonly string[],
): HardSwitchValue[] {
  const all: HardSwitchValue[] = [
    ...consultable.map((role): HardSwitchValue => ({ kind: "consult", role })),
    { kind: "ask-me" },
    { kind: "never" },
  ];
  return all.filter((setting) => BREADTH[setting.kind] < BREADTH[card.kind]);
}

/**
 * The Agent Stage with `changes` to its permissions, an undefined one back at the Role card's. A
 * Stage that states nothing has no permissions at all, as one saved before them.
 */
export function withPermissions(stage: AgentStage, changes: PermissionChanges): AgentStage {
  const { permissions: current, ...rest } = stage;
  const merged: StagePermissions = withoutUndefined({ ...current, ...changes });
  return Object.keys(merged).length === 0 ? rest : { ...rest, permissions: merged };
}

/** The Stage's MCP tool settings with `key` set, or back at the card's when `setting` is undefined. */
export function withMcpToolSetting(
  stage: AgentStage,
  key: string,
  setting: HardSwitchValue | undefined,
): AgentStage {
  const others = Object.entries(stage.permissions?.mcpTools ?? {}).filter(([each]) => each !== key);
  const mcpTools = Object.fromEntries(setting ? [...others, [key, setting]] : others);
  return withPermissions(stage, {
    mcpTools: Object.keys(mcpTools).length === 0 ? undefined : mcpTools,
  });
}

function withoutUndefined<Value extends object>(value: Value): Value {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as Value;
}

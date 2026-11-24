import {
  ACTION_FIELDS,
  sameField as sameActionField,
  type Action,
  type ActionFields,
} from "./action.js";
import type { ProjectEnvironment, ProjectVariable } from "./project-environment.js";
import type { SettingChangeToRecord } from "./project-setting-change.js";
import {
  TEST_TARGET_FIELDS,
  sameField as sameTestTargetField,
  sameSecret,
  type TestTarget,
} from "./test-target.js";

/**
 * What a change records: given whole, or made from the setting as stored before the change and as
 * it is saved, for a summary that depends on what was there.
 */
export type SettingChangeRecording<Stored> =
  SettingChangeToRecord | ((before: Stored, after: Stored) => SettingChangeToRecord);

/** The record a recording makes of the stored setting before and after its change. */
export function recordOf<Stored>(
  recording: SettingChangeRecording<Stored>,
  before: Stored,
  after: Stored,
): SettingChangeToRecord {
  return typeof recording === "function" ? recording(before, after) : recording;
}

/*
 * Each summary is a phrase that follows who made the change, in the Project page's words: "changed
 * Install", "turned Run environment On". A variable is named, never its value, secret or not.
 */

export const INSTALL_CHANGED = "changed Install";
export const INSTALL_INPUTS_CHANGED = "changed Install inputs";
/** An applied Proposal of commands, which may touch Install, its inputs and any command at once. */
export const COMMANDS_CHANGED = "changed Commands";

export function commandAddedSummary(key: string): string {
  return `added the command ${key}`;
}

export function commandChangedSummary(key: string): string {
  return `changed the command ${key}`;
}

export function commandRemovedSummary(key: string): string {
  return `removed the command ${key}`;
}

export function runEnvironmentSummary(runEnvironment: "on" | "off"): string {
  return `turned Run environment ${runEnvironment === "on" ? "On" : "Off"}`;
}

/** What changed among the Environment's variables and folders, by name only. */
export function environmentSummary(before: ProjectEnvironment, after: ProjectEnvironment): string {
  const set = after.set
    .filter((variable) => !before.set.some((each) => sameVariable(each, variable)))
    .map(({ name }) => name);
  const removed = before.set
    .filter(({ name }) => !after.set.some((each) => each.name === name))
    .map(({ name }) => name);
  const parts = [
    ...(set.length > 0 ? [`set ${variablesWords(set)}`] : []),
    ...(removed.length > 0 ? [`removed ${variablesWords(removed)}`] : []),
    ...(sameList(before.unset, after.unset) ? [] : ["changed Variables to remove"]),
    ...(sameList(before.prependPath, after.prependPath)
      ? []
      : ["changed Folders in front of PATH"]),
  ];
  return parts.length > 0 ? joinedWords(parts) : "changed Environment variables";
}

/** One target added, changed or removed by its name; more than one, "changed Test targets". */
export function testTargetsSummary(
  before: readonly TestTarget[],
  after: readonly TestTarget[],
): string {
  return listSummary(before, after, sameTestTarget, "Test target", "Test targets");
}

/** One Action added, changed or removed by its name; more than one, "changed Actions". */
export function actionsSummary(before: readonly Action[], after: readonly Action[]): string {
  return listSummary(before, after, sameAction, "Action", "Actions");
}

interface Named {
  readonly key: string;
  readonly name: string;
}

function listSummary<Item extends Named>(
  before: readonly Item[],
  after: readonly Item[],
  same: (one: Item, other: Item) => boolean,
  one: string,
  many: string,
): string {
  const added = after.filter(({ key }) => !before.some((each) => each.key === key));
  const removed = before.filter(({ key }) => !after.some((each) => each.key === key));
  const changed = after.filter((item) =>
    before.some((each) => each.key === item.key && !same(each, item)),
  );
  const [only] = [...added, ...removed, ...changed];
  if (only === undefined || added.length + removed.length + changed.length > 1) {
    return `changed ${many}`;
  }
  if (added.length === 1) return `added the ${one} ${only.name}`;
  if (removed.length === 1) return `removed the ${one} ${only.name}`;
  return `changed the ${one} ${only.name}`;
}

function sameTestTarget(one: TestTarget, other: TestTarget): boolean {
  return TEST_TARGET_FIELDS.every((field) => sameTestTargetField(field, one, other, sameSecret));
}

function sameAction(one: ActionFields, other: ActionFields): boolean {
  return ACTION_FIELDS.every((field) => sameActionField(field, one, other));
}

function sameVariable(one: ProjectVariable, other: ProjectVariable): boolean {
  return one.name === other.name && one.value === other.value && one.secret === other.secret;
}

function sameList(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((each, index) => each === other[index]);
}

function variablesWords(names: readonly string[]): string {
  return names.length === 1
    ? `the Environment variable ${names[0]}`
    : `the Environment variables ${names.join(", ")}`;
}

function joinedWords(parts: readonly string[]): string {
  if (parts.length === 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

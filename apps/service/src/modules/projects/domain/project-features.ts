import type { RunEnvironmentSetting } from "./project.js";
import { ProjectRefused } from "./project-refused.js";

/**
 * The Office's features a Project switches on or off (spec §2.1.1, "Feature switches"), mirrored
 * by contracts' `PROJECT_FEATURES`, which the controller's test keeps equal.
 */
export const PROJECT_FEATURES = [
  "connected-devices",
  "test-targets",
  "github-issues",
  "run-environment",
  "actions",
] as const;
export type ProjectFeature = (typeof PROJECT_FEATURES)[number];

/**
 * The switch of a Project's issues on its code host. Its key and name say GitHub, the one code
 * host with issues today, as the spec and the contract name it; code reads the switch by this
 * name, never by its key.
 */
export const ISSUES_FEATURE = "github-issues" satisfies ProjectFeature;

/** A feature's rules: what it needs on, and how it reads while the Project never set it. */
export interface ProjectFeatureEntry {
  readonly needs: readonly ProjectFeature[];
  /** How a Project that never set the switch reads it, so a Project added before it keeps today's. */
  readonly whenUnset: boolean;
  /** Set for a feature held by a setting of its own rather than in the switches. */
  readonly backedBy?: "run-environment-setting";
  /** Its name in the UI's words, for refusals. */
  readonly name: string;
  /** Whether its name is plural ("are switched off") or not ("is switched off"). */
  readonly plural: boolean;
}

/** Adding a feature is one entry here plus its key in contracts. */
export const PROJECT_FEATURE_REGISTRY: Readonly<Record<ProjectFeature, ProjectFeatureEntry>> = {
  "connected-devices": {
    needs: ["run-environment"],
    whenUnset: true,
    name: "Connected devices",
    plural: true,
  },
  "test-targets": { needs: [], whenUnset: true, name: "Test targets", plural: true },
  "github-issues": { needs: [], whenUnset: true, name: "GitHub issues", plural: true },
  "run-environment": {
    needs: [],
    whenUnset: false,
    backedBy: "run-environment-setting",
    name: "Run environment",
    plural: false,
  },
  actions: { needs: [], whenUnset: true, name: "Actions", plural: true },
};

/** A feature whose switch is kept in the Project's switches, not by a setting of its own. */
export type StoredProjectFeature = Exclude<ProjectFeature, "run-environment">;

/** The switches the Project set, by key; a key left out reads as its feature's `whenUnset`. */
export type ProjectFeatureSwitches = Readonly<Partial<Record<StoredProjectFeature, boolean>>>;

/** Every feature on or off as the Project reads it now. */
export type ProjectFeatureStates = Readonly<Record<ProjectFeature, boolean>>;

/** What a Project's features are read from. */
export interface ProjectFeatureSource {
  readonly features: ProjectFeatureSwitches;
  readonly runEnvironment: RunEnvironmentSetting;
}

export function isStoredFeature(feature: ProjectFeature): feature is StoredProjectFeature {
  return PROJECT_FEATURE_REGISTRY[feature].backedBy === undefined;
}

/** The known stored keys with boolean values, anything else dropped, so a retired key needs no migration. */
export function featureSwitchesOfStored(stored: unknown): ProjectFeatureSwitches {
  if (typeof stored !== "object" || stored === null) return {};
  const switches: Partial<Record<StoredProjectFeature, boolean>> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (isKnownStoredFeature(key) && typeof value === "boolean") switches[key] = value;
  }
  return switches;
}

function isKnownStoredFeature(key: string): key is StoredProjectFeature {
  return (
    (PROJECT_FEATURES as readonly string[]).includes(key) && isStoredFeature(key as ProjectFeature)
  );
}

/** On only when its own switch is on and every feature it needs is on. */
export function isFeatureOn(source: ProjectFeatureSource, feature: ProjectFeature): boolean {
  const entry = PROJECT_FEATURE_REGISTRY[feature];
  return ownSwitchOf(source, feature) && entry.needs.every((needed) => isFeatureOn(source, needed));
}

function ownSwitchOf(source: ProjectFeatureSource, feature: ProjectFeature): boolean {
  if (!isStoredFeature(feature)) return source.runEnvironment === "on";
  return source.features[feature] ?? PROJECT_FEATURE_REGISTRY[feature].whenUnset;
}

export function featureStatesOf(source: ProjectFeatureSource): ProjectFeatureStates {
  return Object.fromEntries(
    PROJECT_FEATURES.map((feature) => [feature, isFeatureOn(source, feature)]),
  ) as Record<ProjectFeature, boolean>;
}

/** The words a refusal of a switched-off feature names it with. */
export function switchedOffWords(feature: ProjectFeature, projectName: string): string {
  const { name, plural } = PROJECT_FEATURE_REGISTRY[feature];
  return `${name} ${plural ? "are" : "is"} switched off for «${projectName}».`;
}

/** A feature that is switched off for the Project was asked for. */
export class FeatureSwitchedOff extends ProjectRefused {
  constructor(
    readonly feature: ProjectFeature,
    projectName: string,
  ) {
    super([switchedOffWords(feature, projectName)]);
    this.name = "FeatureSwitchedOff";
  }
}

/**
 * The switches after `changes`, refused when one turns on while a feature it needs is off; turning
 * one off also turns off each stored feature that needs it. Run environment is changed through its
 * own setting, so only stored features are changed here.
 */
export function changedFeatureSwitches(
  source: ProjectFeatureSource,
  projectName: string,
  changes: ProjectFeatureSwitches,
): ProjectFeatureSwitches {
  const switches: Partial<Record<StoredProjectFeature, boolean>> = { ...source.features };
  for (const [feature, on] of Object.entries(changes) as [StoredProjectFeature, boolean][]) {
    switches[feature] = on;
  }
  for (const [feature, on] of Object.entries(changes) as [StoredProjectFeature, boolean][]) {
    if (!on) switchOffDependents(switches, feature);
  }
  const after = { ...source, features: switches };
  const problems = (Object.entries(changes) as [StoredProjectFeature, boolean][])
    .filter(([, on]) => on)
    .flatMap(([feature]) =>
      PROJECT_FEATURE_REGISTRY[feature].needs
        .filter((needed) => !isFeatureOn(after, needed))
        .map((needed) => needsWords(feature, needed, projectName)),
    );
  if (problems.length > 0) throw new ProjectRefused(problems);
  return switches;
}

function needsWords(feature: ProjectFeature, needed: ProjectFeature, projectName: string): string {
  const { name, plural } = PROJECT_FEATURE_REGISTRY[feature];
  const neededName = PROJECT_FEATURE_REGISTRY[needed].name;
  return `${name} ${plural ? "need" : "needs"} ${neededName}, which is off for «${projectName}».`;
}

function switchOffDependents(
  switches: Partial<Record<StoredProjectFeature, boolean>>,
  switchedOff: ProjectFeature,
): void {
  for (const feature of PROJECT_FEATURES) {
    if (!isStoredFeature(feature) || switches[feature] === false) continue;
    if (!PROJECT_FEATURE_REGISTRY[feature].needs.includes(switchedOff)) continue;
    switches[feature] = false;
    switchOffDependents(switches, feature);
  }
}

export function sameFeatureSwitches(
  first: ProjectFeatureSwitches,
  second: ProjectFeatureSwitches,
): boolean {
  return PROJECT_FEATURES.filter(isStoredFeature).every(
    (feature) => first[feature] === second[feature],
  );
}

import type { ProjectFeature } from "@the-office/contracts";

/** Each feature switch's name and one-line hint, in the Features tab's order (spec §2.1.1). */
export const FEATURE_ROWS: readonly {
  readonly feature: ProjectFeature;
  readonly name: string;
  readonly line: string;
}[] = [
  {
    feature: "connected-devices",
    name: "Connected devices",
    line: "Devices connected to a Task's run environment.",
  },
  {
    feature: "test-targets",
    name: "Test targets",
    line: "What can be launched on an Initiative's branch to try the work.",
  },
  {
    feature: "github-issues",
    name: "GitHub issues",
    line: "Import issues as Tasks and write back to them.",
  },
  {
    feature: "run-environment",
    name: "Run environment",
    line: "Checks run in the containers .devcontainer/ defines.",
  },
];

/** The feature each one needs on before it can be switched on. */
export const FEATURE_NEEDS: Readonly<Partial<Record<ProjectFeature, ProjectFeature>>> = {
  "connected-devices": "run-environment",
};

export function featureName(feature: ProjectFeature): string {
  return FEATURE_ROWS.find((row) => row.feature === feature)?.name ?? feature;
}

/** Why a switch is held: "Needs Run environment". */
export function needsWords(needed: ProjectFeature): string {
  return `Needs ${featureName(needed)}`;
}

/** A switched-off feature's section: "Test targets are switched off for «the-office»." */
export function switchedOffWords(feature: ProjectFeature, projectName: string): string {
  const verb = feature === "run-environment" ? "is" : "are";
  return `${featureName(feature)} ${verb} switched off for «${projectName}».`;
}

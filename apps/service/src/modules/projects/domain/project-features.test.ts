import { describe, expect, it } from "vitest";
import { changeFeatures } from "./project-changes.js";
import { ProjectFeaturesChanged } from "./project-events.js";
import {
  FeatureSwitchedOff,
  featureStatesOf,
  featureSwitchesOfStored,
  isFeatureOn,
} from "./project-features.js";
import { aProject } from "./project.fixtures.js";
import { ProjectRefused } from "./project-refused.js";

describe("a Project's features", () => {
  it("read on while never set, but Run environment follows its own setting", () => {
    expect(featureStatesOf(aProject({ runEnvironment: "on" }))).toEqual({
      "connected-devices": true,
      "test-targets": true,
      "github-issues": true,
      "run-environment": true,
      actions: true,
    });
    for (const runEnvironment of ["off"] as const) {
      expect(featureStatesOf(aProject({ runEnvironment }))).toEqual({
        "connected-devices": false,
        "test-targets": true,
        "github-issues": true,
        "run-environment": false,
        actions: true,
      });
    }
  });

  it("read Connected devices off while Run environment isn't On, whatever their switch", () => {
    const project = aProject({ runEnvironment: "off", features: { "connected-devices": true } });

    expect(isFeatureOn(project, "connected-devices")).toBe(false);
    expect(isFeatureOn({ ...project, runEnvironment: "on" }, "connected-devices")).toBe(true);
  });

  it("keep only the known stored keys with boolean values", () => {
    expect(
      featureSwitchesOfStored({
        "github-issues": false,
        "test-targets": "no",
        "run-environment": false,
        "retired-feature": false,
      }),
    ).toEqual({ "github-issues": false });
    expect(featureSwitchesOfStored(null)).toEqual({});
    expect(featureSwitchesOfStored([true])).toEqual({});
  });

  it("refuse a switched-off feature in words naming it and the Project", () => {
    expect(new FeatureSwitchedOff("github-issues", "Tools").reasons).toEqual([
      "GitHub issues are switched off for «Tools».",
    ]);
    expect(new FeatureSwitchedOff("github-issues", "Tools")).toBeInstanceOf(ProjectRefused);
  });
});

describe("changeFeatures", () => {
  it("keeps the switches changed and announces every feature as it reads after", () => {
    const change = changeFeatures(aProject({ runEnvironment: "on" }), { "github-issues": false });

    expect(change?.project.features).toEqual({ "github-issues": false });
    expect(change?.event).toBeInstanceOf(ProjectFeaturesChanged);
    expect(change?.event).toMatchObject({
      projectId: "admin-panel",
      features: {
        "connected-devices": true,
        "test-targets": true,
        "github-issues": false,
        "run-environment": true,
        actions: true,
      },
    });
  });

  it("changes nothing when every switch is already so", () => {
    const project = aProject({ features: { "test-targets": false } });

    expect(changeFeatures(project, { "test-targets": false })).toBeUndefined();
    expect(changeFeatures(project, {})).toBeUndefined();
  });

  it("refuses turning Connected devices on while Run environment is off, saying why", () => {
    const project = aProject({
      name: "Firmware",
      runEnvironment: "off",
      features: { "connected-devices": false },
    });

    expect(() => changeFeatures(project, { "connected-devices": true })).toThrow(
      new ProjectRefused(["Connected devices need Run environment, which is off for «Firmware»."]),
    );
  });
});

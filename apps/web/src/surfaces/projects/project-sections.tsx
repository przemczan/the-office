import { useSearch } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppearanceBlock } from "./appearance-block.tsx";
import { CommandsBlock } from "./commands-block.tsx";
import { EngineBlock } from "./engine-block.tsx";
import { EnvironmentCheckBlock } from "./environment-check-block.tsx";
import { EnvironmentVariablesBlock } from "./environment-variables-block.tsx";
import { FeaturesBlock } from "./features-block.tsx";
import { GitHubIssuesBlock } from "./issues/github-issues-block.tsx";
import { useOpenProject } from "./project-page.tsx";
import { RunEnvironmentBlock } from "./run-environment-block.tsx";
import { ServerValuesBlock } from "./server-values-block.tsx";
import { SkillsBlock } from "./skills-block.tsx";
import { TestInstancesBlock } from "./test-instances-block.tsx";
import { TestTargetsBlock } from "./test-targets-block.tsx";

export function ProjectCommandsSection(): ReactNode {
  return <CommandsBlock project={useOpenProject()} />;
}

/** The Project's environment, saved by its Save, and the check that tries the saved one. */
export function ProjectEnvironmentSection(): ReactNode {
  const project = useOpenProject();
  return (
    <>
      <EnvironmentVariablesBlock project={project} />
      <EnvironmentCheckBlock project={project} />
    </>
  );
}

/** GitHub issues: Import issues…, the auto-import label and the write-back switches. */
export function ProjectIssuesSection(): ReactNode {
  return <GitHubIssuesBlock project={useOpenProject()} />;
}

export function ProjectRunEnvironmentSection(): ReactNode {
  return <RunEnvironmentBlock project={useOpenProject()} />;
}

/**
 * The Project's test targets, then its Test instances, launched on any branch; a link to an
 * instance lands on its row.
 */
export function ProjectTestTargetsSection(): ReactNode {
  const project = useOpenProject();
  const { testInstance } = useSearch({ from: "/projects/$projectId/test-targets" });
  return (
    <>
      <TestTargetsBlock project={project} />
      <TestInstancesBlock project={project} linkedTo={testInstance} />
    </>
  );
}

export function ProjectEngineSection(): ReactNode {
  return <EngineBlock project={useOpenProject()} />;
}

export function ProjectSkillsSection(): ReactNode {
  return <SkillsBlock project={useOpenProject()} />;
}

export function ProjectServerValuesSection(): ReactNode {
  return <ServerValuesBlock project={useOpenProject()} />;
}

export function ProjectFeaturesSection(): ReactNode {
  return <FeaturesBlock project={useOpenProject()} />;
}

export function ProjectAppearanceSection(): ReactNode {
  return <AppearanceBlock project={useOpenProject()} />;
}

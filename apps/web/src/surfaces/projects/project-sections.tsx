import type { ReactNode } from "react";
import { AppearanceBlock } from "./appearance-block.tsx";
import { CommandsBlock } from "./commands-block.tsx";
import { EngineBlock } from "./engine-block.tsx";
import { EnvironmentCheckBlock } from "./environment-check-block.tsx";
import { EnvironmentVariablesBlock } from "./environment-variables-block.tsx";
import { OnboardingBlock } from "./onboarding-block.tsx";
import { useOpenProject } from "./project-page.tsx";
import { RunEnvironmentBlock } from "./run-environment-block.tsx";
import { ServerValuesBlock } from "./server-values-block.tsx";
import { SkillsBlock } from "./skills-block.tsx";
import { WorkBlock } from "./work-block.tsx";

/** How the Project stands: its onboarding and its Tasks. */
export function ProjectOverviewSection(): ReactNode {
  const project = useOpenProject();
  return (
    <>
      <OnboardingBlock project={project} />
      <WorkBlock project={project} />
    </>
  );
}

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

export function ProjectRunEnvironmentSection(): ReactNode {
  return <RunEnvironmentBlock project={useOpenProject()} />;
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

export function ProjectAppearanceSection(): ReactNode {
  return <AppearanceBlock project={useOpenProject()} />;
}

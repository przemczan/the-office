import type { ReactNode } from "react";
import { AppearanceBlock } from "./appearance-block.tsx";
import { CommandsBlock } from "./commands-block.tsx";
import { DefaultPipelineBlock } from "./default-pipeline-block.tsx";
import { EngineBlock } from "./engine-block.tsx";
import { EnvironmentBlock } from "./environment-block.tsx";
import { OnboardingBlock } from "./onboarding-block.tsx";
import { useOpenProject } from "./project-page.tsx";
import { ServerValuesBlock } from "./server-values-block.tsx";
import { SkillsBlock } from "./skills-block.tsx";
import { WorkBlock } from "./work-block.tsx";

/** How the Project stands: its onboarding, its environment and its Tasks. */
export function ProjectOverviewSection(): ReactNode {
  const project = useOpenProject();
  return (
    <>
      <OnboardingBlock project={project} />
      <EnvironmentBlock project={project} />
      <WorkBlock project={project} />
    </>
  );
}

export function ProjectCommandsSection(): ReactNode {
  return <CommandsBlock project={useOpenProject()} />;
}

export function ProjectDefaultPipelineSection(): ReactNode {
  return <DefaultPipelineBlock project={useOpenProject()} />;
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

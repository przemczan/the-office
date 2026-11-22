import type { Project } from "@the-office/contracts";
import type { ReactNode } from "react";
import { repositoryAddressOf } from "./github-repository-words.ts";
import { useOnboarding } from "./onboarding-block.tsx";

/**
 * The line under a Project's name in the Projects list: where it lives and its base branch, led by
 * "Onboarding" while its latest Onboard Task is in flight (spec screens/projects.md, Project item).
 */
export function ProjectItemLine({ project }: { readonly project: Project }): ReactNode {
  const onboarding = useOnboarding(project.id);
  return (
    <>
      {onboarding?.state === "onboarding" && (
        <>
          <span className="project-item-onboarding">Onboarding</span>
          {" · "}
        </>
      )}
      {whereItLives(project)} · {project.baseBranch}
    </>
  );
}

/** owner/repository from its Repository URL, else its folder's name. */
export function whereItLives(project: Pick<Project, "path" | "repositoryUrl">): string {
  if (project.repositoryUrl !== null) {
    // host/owner/repository, or host/group/subgroup/repository; the host goes.
    const [, ...repository] = repositoryAddressOf(project.repositoryUrl).split("/");
    if (repository.length > 0) return repository.join("/");
  }
  const folders = project.path.split(/[\\/]/).filter((folder) => folder !== "");
  return folders.at(-1) ?? project.path;
}

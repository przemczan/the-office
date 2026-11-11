import type { Project } from "@the-office/contracts";

/** Every command key one of the Projects has, each once, in alphabetical order. */
export function projectCommandKeys(projects: readonly Pick<Project, "commands">[]): string[] {
  return [
    ...new Set(projects.flatMap(({ commands }) => commands.map(({ key }) => key))),
  ].toSorted();
}

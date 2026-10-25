import type { NewProject, Project } from "./project.js";

export function aNewProject(fields: Partial<NewProject> = {}): NewProject {
  return {
    name: "Admin panel",
    path: "/work/admin-panel",
    baseBranch: "main",
    mark: { label: "AP", colour: "teal" },
    commands: { install: "npm ci", build: "npm run build", lint: "npm run lint", test: "npm test" },
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
    ...fields,
  };
}

export function aProject(fields: Partial<Project> = {}): Project {
  return {
    id: "admin-panel",
    ...aNewProject(),
    useProjectSkills: true,
    addedAt: new Date("2026-10-25T09:00:00.000Z"),
    ...fields,
  };
}

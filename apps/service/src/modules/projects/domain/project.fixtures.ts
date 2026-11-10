import type { NewProject, Project } from "./project.js";
import { UNCHANGED_ENVIRONMENT } from "./project-environment.js";
import { NO_PROJECT_IMAGE } from "./project-image.js";

export function aNewProject(fields: Partial<NewProject> = {}): NewProject {
  return {
    name: "Admin panel",
    path: "/work/admin-panel",
    baseBranch: "main",
    mark: { label: "AP", colour: "teal" },
    commands: { install: "npm ci", build: "npm run build", lint: "npm run lint", test: "npm test" },
    installInputs: ["package-lock.json"],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
    ...fields,
  };
}

export function aProject(fields: Partial<Project> = {}): Project {
  return {
    id: "admin-panel",
    ...aNewProject(),
    repositoryUrl: null,
    icon: NO_PROJECT_IMAGE,
    logo: NO_PROJECT_IMAGE,
    environment: UNCHANGED_ENVIRONMENT,
    useProjectSkills: true,
    projectSkillsOff: [],
    projectDefault: null,
    useForEveryRole: false,
    roleOverrides: [],
    runEnvironment: "not-decided",
    runEnvironmentSetUpProblems: [],
    projectLimit: 1,
    addedAt: new Date("2026-10-25T09:00:00.000Z"),
    ...fields,
  };
}

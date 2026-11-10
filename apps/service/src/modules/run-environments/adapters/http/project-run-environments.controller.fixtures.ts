import { randomUUID } from "node:crypto";
import {
  projectRunEnvironmentSchema,
  type NewProject,
  type ProjectRunEnvironment,
} from "@the-office/contracts";
import { expect } from "vitest";

export function newProjectIn(path: string): NewProject {
  return {
    name: `Shop ${randomUUID().slice(0, 8)}`,
    path,
    baseBranch: "main",
    mark: { label: "SH", colour: "teal" },
    commands: { install: "npm ci", build: "npm run build", lint: "npm run lint", test: "npm test" },
    installInputs: [],
    publishingMode: "merge",
    defaultPipeline: "full",
  };
}

export async function runEnvironmentOf(response: Response): Promise<ProjectRunEnvironment> {
  expect(response.status).toBeLessThan(300);
  return projectRunEnvironmentSchema.parse(await response.json());
}

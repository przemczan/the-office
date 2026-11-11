import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markLabelFor, PROPOSE_PROJECT_TOOL } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { ProposalDraftsForTests } from "../../ports/work-ports.fixtures.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";

const SESSION = "devops-chat";

const DRAFTED = {
  name: "Shop",
  baseBranch: "main",
  installCommand: "npm ci",
  commands: [
    { key: "build", name: "Build", kind: "build", commandLine: "npm run build" },
    { key: "lint", name: "Lint", kind: "lint", commandLine: "npm run lint" },
    { key: "test", name: "Test", kind: "test", commandLine: "npm test" },
  ],
  installInputs: ["package-lock.json"],
  publishingMode: "merge",
  defaultPipeline: "quick-fix",
};

let folder: string;
let work: WorkApplication;

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-onboarding-tools-"));
});

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(join(folder, "office-data"));
});

afterEach(async () => {
  await work.app.close();
});

function proposeProject(input: Record<string, unknown>) {
  const [tool] = work.app.get(OfficeToolRegistry).named([PROPOSE_PROJECT_TOOL]);
  if (!tool) throw new Error(`No Office tool ${PROPOSE_PROJECT_TOOL}.`);
  return tool.run(tool.input.parse(input), anOfficeToolCall(SESSION));
}

describe("propose_project", () => {
  const mark = { label: markLabelFor("Shop"), colour: "teal" };

  it("drafts a repository on the workstation by its path", async () => {
    const answer = await proposeProject({ ...DRAFTED, path: "/code/shop" });

    expect(answer.isError).toBe(false);
    expect(work.app.get(ProposalDraftsForTests).drafted).toEqual([
      {
        sessionId: SESSION,
        change: {
          kind: "project",
          project: { ...DRAFTED, path: "/code/shop", mark },
          projectId: undefined,
          taskId: undefined,
        },
      },
    ]);
  });

  it("drafts a repository on a host by its Repository URL, with its clone's folder as the path", async () => {
    const url = "https://github.com/acme/shop";

    const answer = await proposeProject({ ...DRAFTED, url });

    expect(answer.isError).toBe(false);
    expect(work.app.get(ProposalDraftsForTests).drafted.map(({ change }) => change)).toEqual([
      {
        kind: "project",
        project: { ...DRAFTED, path: "/repositories/shop", repositoryUrl: url, mark },
        projectId: undefined,
        taskId: undefined,
      },
    ]);
  });

  it("refuses both a path and a URL, and neither, drafting nothing", async () => {
    const both = await proposeProject({
      ...DRAFTED,
      path: "/code/shop",
      url: "https://github.com/acme/shop",
    });
    const neither = await proposeProject(DRAFTED);

    for (const answer of [both, neither]) {
      expect(answer).toEqual({
        text: expect.stringContaining(
          "Give the repository's path on the workstation or its Repository URL, one of the two.",
        ),
        isError: true,
      });
    }
    expect(work.app.get(ProposalDraftsForTests).drafted).toEqual([]);
  });
});

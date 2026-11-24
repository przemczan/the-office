import type { Project, RunEnvironmentSetting, StageRun } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { closePage, openPage, stubService, until, type Sent } from "../../shell/page.fixtures.tsx";
import { CarriedRunEnvironmentNote } from "./carried-run-environment-note.tsx";
import { CARRIED_RUN_ENVIRONMENT, ranInCarriedRunEnvironment } from "./stage-words.ts";

afterEach(closePage);

const TASK = { id: "0f6c1d2e-3b4a-4c5d-8e9f-a0b1c2d3e4f5", projectId: "notnullsoft" };
const ROUTE = `GET /api/projects/notnullsoft/tasks/${TASK.id}/run-environment`;

function aProject(runEnvironment: RunEnvironmentSetting): Project {
  return { id: "notnullsoft", name: "notnullsoft", runEnvironment } as Project;
}

async function noteWith(
  runEnvironment: RunEnvironmentSetting,
  carriesDefinition: boolean,
): Promise<{ page: HTMLElement; sent: Sent[] }> {
  const sent = stubService({ [ROUTE]: () => ({ status: 200, body: { carriesDefinition } }) });
  const projects = [aProject(runEnvironment)];
  const { page } = await openPage("/", {
    "/": () => <CarriedRunEnvironmentNote task={TASK} projects={projects} />,
  });
  return { page, sent };
}

describe("the Task page's note on a run environment its branch carries", () => {
  it("says the Task's commands run in its run environment while the Project hasn't decided", async () => {
    const { page } = await noteWith("not-decided", true);

    await until(() =>
      expect(page.querySelector('[role="status"]')?.textContent).toBe(
        "Runs in this Task's run environment (its branch carries the definition)",
      ),
    );
  });

  it("says nothing when the branch carries no valid definition", async () => {
    const { page, sent } = await noteWith("not-decided", false);

    await until(() => expect(sent.length).toBe(1));
    expect(page.textContent).toBe("");
  });

  it("asks nothing and says nothing once the Project's Run environment is On or Off", async () => {
    for (const setting of ["on", "off"] as const) {
      const { page, sent } = await noteWith(setting, true);
      expect(page.textContent).toBe("");
      expect(sent).toEqual([]);
      closePage();
    }
  });
});

function aRun(commandRuns: StageRun["commandRuns"]): StageRun {
  return { commandRuns } as StageRun;
}

describe("a Script Stage run's place", () => {
  const command = {
    purpose: "command",
    commandLine: "npm test",
    outcome: "passed",
    durationMs: 1200,
  } as const;

  it("is the carried run environment when any of its commands ran there", () => {
    expect(ranInCarriedRunEnvironment(aRun([{ ...command, inCarriedRunEnvironment: true }]))).toBe(
      true,
    );
    expect(ranInCarriedRunEnvironment(aRun([command]))).toBe(false);
    expect(CARRIED_RUN_ENVIRONMENT).toBe(
      "Runs in this Task's run environment (its branch carries the definition)",
    );
  });
});

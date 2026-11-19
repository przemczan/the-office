import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { PullRequestClosed, PullRequestReopened } from "../../projects/index.js";
import { startWorkApplication, type WorkApplication } from "../work-application.fixtures.js";

let officeData: string;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-pull-request-outcomes-full-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(officeData);
});

afterEach(async () => {
  await work.app.close();
});

describe("PullRequestOutcomes", () => {
  it("does nothing for a Task The Office doesn't know", async () => {
    const taskId = randomUUID();
    const url = "https://github.com/acme/admin-panel/pull/7";
    const events = work.app.get(EventBus);

    await events.publish(
      new PullRequestClosed(
        randomUUID(),
        "admin-panel",
        taskId,
        7,
        url,
        { kind: "code-host", name: "GitHub" },
        new Date(),
      ),
    );
    await events.publish(
      new PullRequestReopened(randomUUID(), "admin-panel", taskId, 7, url, new Date()),
    );

    expect(work.published.map((event) => event.constructor.name)).toEqual([
      "PullRequestClosed",
      "PullRequestReopened",
    ]);
  });
});

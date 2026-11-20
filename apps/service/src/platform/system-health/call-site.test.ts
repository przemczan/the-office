import { describe, expect, it } from "vitest";
import { callSiteOf } from "./call-site.js";

const ROOT = "/opt/the-office/current";

describe("callSiteOf", () => {
  it("names the first frame in the service's code past the database layer, from the built service's source maps", () => {
    const stack = [
      "Error: ",
      `    at BoundPool.query (${ROOT}/apps/service/src/platform/database/database-pool.ts:52:23)`,
      `    at NodePgPreparedQuery.execute (file://${ROOT}/node_modules/drizzle-orm/node-postgres/session.js:101:19)`,
      `    at DrizzleTaskRepository.findById (${ROOT}/apps/service/src/modules/work/adapters/drizzle-task-repository.ts:142:31)`,
      `    at TaskService.read (${ROOT}/apps/service/src/modules/work/application/task-service.ts:20:5)`,
    ].join("\n");

    expect(callSiteOf(stack)).toBe(
      "apps/service/src/modules/work/adapters/drizzle-task-repository.ts:142 (DrizzleTaskRepository.findById)",
    );
  });

  it("reads an async frame and a frame with no function, as vitest writes them", () => {
    const asyncFrame = `Error: \n    at async DrizzleRunRepository.save (file://${ROOT}/apps/service/src/modules/pipelines/adapters/drizzle-run-repository.ts:88:7)`;
    const bareFrame = `Error: \n    at ${ROOT}/apps/service/src/platform/schedule/schedule.ts:40:12`;

    expect(callSiteOf(asyncFrame)).toBe(
      "apps/service/src/modules/pipelines/adapters/drizzle-run-repository.ts:88 (DrizzleRunRepository.save)",
    );
    expect(callSiteOf(bareFrame)).toBe("apps/service/src/platform/schedule/schedule.ts:40");
  });

  it("reads a Windows path", () => {
    const stack =
      "Error: \n    at Fan.out (C:\\Users\\me\\the-office\\apps\\service\\src\\modules\\work\\fan.ts:7:3)";

    expect(callSiteOf(stack)).toBe("apps/service/src/modules/work/fan.ts:7 (Fan.out)");
  });

  it("finds none when no frame is in the service's code past the database layer", () => {
    const stack = [
      "Error: ",
      `    at BoundPool.query (${ROOT}/apps/service/src/platform/database/database-pool.ts:52:23)`,
      `    at QueryPromise.then (file://${ROOT}/node_modules/drizzle-orm/query-promise.js:21:17)`,
      "    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)",
    ].join("\n");

    expect(callSiteOf(stack)).toBeUndefined();
    expect(callSiteOf(undefined)).toBeUndefined();
  });
});

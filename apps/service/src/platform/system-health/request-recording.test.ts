import { Controller, Get, Param, Post } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startTestApplication, type TestApplication } from "../../../test/test-application.js";
import { SystemHealthModule } from "./system-health.module.js";
import { SystemHealthRecorder } from "./system-health-recorder.js";

@Controller("probes")
class ProbesController {
  @Get(":id")
  probe(@Param("id") id: string): { id: string } {
    return { id };
  }

  @Post(":id/answers")
  answer(): { answered: true } {
    return { answered: true };
  }
}

let served: TestApplication | undefined;

afterEach(async () => {
  await served?.app.close();
  served = undefined;
});

describe("recordRequests", () => {
  it("records each request by its method and route template under /api, never its address; no route is Unmatched", async () => {
    served = await startTestApplication({
      imports: [SystemHealthModule],
      controllers: [ProbesController],
    });
    const { url, app } = served;

    await fetch(`${url}/api/probes/42`);
    await fetch(`${url}/api/probes/43?secret=yes`);
    await fetch(`${url}/api/probes/42/answers`, { method: "POST" });
    expect((await fetch(`${url}/api/nowhere/7`)).status).toBe(404);

    // A response finishes on the server just after the client reads it.
    await vi.waitFor(() => {
      const routes = app.get(SystemHealthRecorder).lastHour().slowestRoutes;
      expect(routes.map(({ route, count }) => ({ route, count }))).toEqual(
        expect.arrayContaining([
          { route: { method: "GET", template: "/api/probes/:id" }, count: 2 },
          { route: { method: "POST", template: "/api/probes/:id/answers" }, count: 1 },
          { route: null, count: 1 },
        ]),
      );
      expect(routes).toHaveLength(3);
    });
  });
});

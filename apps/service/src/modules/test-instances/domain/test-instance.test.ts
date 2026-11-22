import { describe, expect, it } from "vitest";
import { BY_RESTART, BY_USER } from "./stop-reason.js";
import { built, failed, launchedInstance, startedRunning, stopped } from "./test-instance.js";

const AT = new Date("2026-11-21T10:00:00Z");

function launched(kind: "hosted" | "build-to-install") {
  const given = {
    id: "instance-1",
    initiativeId: "initiative-1",
    projectId: "the-office",
    branch: "initiative/notes",
    targetKey: "web",
    targetName: "Web app",
    launchedBy: { kind: "user" as const, user: { userId: "user-1", name: "Ada" } },
    at: AT,
  };
  return kind === "hosted"
    ? launchedInstance({ ...given, kind, port: 4400 })
    : launchedInstance({ ...given, kind });
}

describe("a test instance's state change event", () => {
  it("carries the target's name and branch, and no failure or stop on Running", () => {
    const event = startedRunning(launched("hosted"), AT)?.event;
    expect(event).toMatchObject({
      instanceId: "instance-1",
      initiativeId: "initiative-1",
      from: "building",
      to: "running",
      port: 4400,
      targetName: "Web app",
      branch: "initiative/notes",
      failedReason: undefined,
      stoppedBy: undefined,
    });
  });

  it("carries the files' names, and no failure or stop, on Built", () => {
    const event = built(launched("build-to-install"), [{ name: "app.apk", size: 3 }], AT)?.event;
    expect(event).toMatchObject({
      to: "built",
      files: ["app.apk"],
      failedReason: undefined,
      stoppedBy: undefined,
    });
  });

  it("carries why it failed, and no stop, on a failure", () => {
    const event = failed(launched("hosted"), "Exited with code 1.", AT)?.event;
    expect(event).toMatchObject({
      to: "failed",
      failedReason: "Exited with code 1.",
      stoppedBy: undefined,
    });
  });

  it("carries how it was stopped on a Hosted instance's Stopped", () => {
    const event = stopped(launched("hosted"), BY_RESTART, AT)?.event;
    expect(event).toMatchObject({ to: "stopped", stoppedBy: "restart" });
  });

  it("fails a Build to install instance on Stop, with the stop's words and how it was stopped", () => {
    const change = stopped(launched("build-to-install"), BY_USER, AT);
    expect(change?.instance.failedReason).toBe("Stopped by you.");
    expect(change?.event).toMatchObject({
      to: "failed",
      failedReason: "Stopped by you.",
      stoppedBy: "by-user",
    });
  });
});

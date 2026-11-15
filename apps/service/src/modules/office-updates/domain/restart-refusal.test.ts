import { describe, expect, it } from "vitest";
import type { OfficeContainerRead } from "./office-container.js";
import {
  NO_LAUNCHER_TO_RESTART,
  NOT_INSTALLED_TO_RESTART,
  RESTART_SCHEDULED_ALREADY,
  UPDATE_SCHEDULED_ALREADY,
  dockerUnreachable,
  noRestartPolicy,
  restartRefusal,
} from "./restart-refusal.js";

function containerWith(restartPolicy: string): OfficeContainerRead {
  return {
    reachable: true,
    container: {
      id: "c0ffee",
      image: "ghcr.io/owner/the-office:1.3.0",
      imageId: "sha256:1234",
      compose: undefined,
      mounts: [],
      restartPolicy,
    },
  };
}

describe("Restart", () => {
  it("is offered under the launcher, for a checkout and an installed release", () => {
    expect(restartRefusal({ install: "checkout", launched: true }, undefined)).toBeUndefined();
    expect(
      restartRefusal({ install: "release", launched: true, installed: true }, undefined),
    ).toBeUndefined();
  });

  it("is refused where nothing would start The Office again", () => {
    expect(restartRefusal({ install: "checkout", launched: false }, undefined)).toBe(
      NO_LAUNCHER_TO_RESTART,
    );
    expect(
      restartRefusal({ install: "release", launched: false, installed: false }, undefined),
    ).toBe(NO_LAUNCHER_TO_RESTART);
    expect(
      restartRefusal({ install: "release", launched: true, installed: false }, undefined),
    ).toBe(NOT_INSTALLED_TO_RESTART);
  });

  it.each(["always", "unless-stopped", "on-failure"])(
    "is offered in a container whose restart policy is %s",
    (policy) => {
      const state = { install: "container" as const, container: containerWith(policy) };
      expect(restartRefusal(state, undefined)).toBeUndefined();
    },
  );

  it("is refused in a container Docker wouldn't start again, or with Docker out of reach", () => {
    const stopped = { install: "container" as const, container: containerWith("no") };
    const unreachable = {
      install: "container" as const,
      container: { reachable: false as const, problem: "EACCES: /var/run/docker.sock" },
    };

    expect(restartRefusal(stopped, undefined)).toBe(noRestartPolicy("no"));
    expect(restartRefusal(unreachable, undefined)).toBe(
      dockerUnreachable("EACCES: /var/run/docker.sock"),
    );
  });

  it("is refused while an update or a restart is scheduled", () => {
    const launched = { install: "checkout" as const, launched: true };

    expect(restartRefusal(launched, "update")).toBe(UPDATE_SCHEDULED_ALREADY);
    expect(restartRefusal(launched, "restart")).toBe(RESTART_SCHEDULED_ALREADY);
  });
});

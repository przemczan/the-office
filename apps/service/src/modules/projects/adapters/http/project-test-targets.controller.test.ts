import type { INestApplication } from "@nestjs/common";
import { projectRefusalSchema, testTargetListSchema } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../../platform/events/event-bus.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { SIGNED_IN_FOR_TESTS } from "../../../../platform/http/signed-in-requests.fixtures.js";
import { ProjectDeviceLines } from "../../application/project-device-lines.js";
import { projectsHttp, startProjectsApplication } from "../../projects.controller.fixtures.js";
import {
  createTemporaryRepository,
  REAL_GIT_TEST,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";
import {
  aBuildToInstallTarget,
  aHostedTarget,
  anInstallOnADeviceTarget,
  commitEntryPoints,
} from "./project-test-targets.controller.fixtures.js";

let repository: TemporaryRepository;
let app: INestApplication;
let url: string;
let published: DomainEvent[];

beforeAll(async () => {
  repository = await createTemporaryRepository();
  await commitEntryPoints(repository);
});

afterAll(async () => {
  await repository.remove();
});

beforeEach(async () => {
  ({ app, url } = await startProjectsApplication(repository));
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
});

afterEach(async () => {
  await app.close();
});

const { send, addProject, webEvents } = projectsHttp(() => ({ app, url, published, repository }));

const BY_YOU = {
  by: "user",
  user: { userId: SIGNED_IN_FOR_TESTS.userId, name: SIGNED_IN_FOR_TESTS.name },
};

function hasDevices(): void {
  app.get(ProjectDeviceLines, { strict: false }).register(async () => [
    {
      id: "device-1",
      kind: "Android phone over USB",
      name: "Pixel 9",
      state: "Over USB",
      androidPhone: true,
    },
    {
      id: "device-2",
      kind: "Serial board over USB",
      name: "Uno",
      state: "Over USB",
      androidPhone: false,
    },
  ]);
}

describe("PUT /api/projects/:id/test-targets", REAL_GIT_TEST, () => {
  it("saves an Install on a device target with a Build to install target and an Android phone", async () => {
    const project = await addProject();
    hasDevices();

    const response = await send("PUT", `/projects/${project.id}/test-targets`, {
      targets: [aBuildToInstallTarget(), anInstallOnADeviceTarget()],
    });

    expect(response.status).toBe(200);
    const { targets } = testTargetListSchema.parse(await response.json());
    expect(targets[1]).toEqual({
      ...anInstallOnADeviceTarget(),
      setBy: {
        name: BY_YOU,
        kind: BY_YOU,
        buildTargetKey: BY_YOU,
        projectDeviceId: BY_YOU,
      },
    });
    const read = await fetch(`${url}/api/projects/${project.id}/test-targets`);
    expect(testTargetListSchema.parse(await read.json()).targets).toEqual(targets);
  });

  it("refuses an Install on a device target naming a missing or wrong-kind Build to install target", async () => {
    const project = await addProject();
    hasDevices();

    const missing = await send("PUT", `/projects/${project.id}/test-targets`, {
      targets: [anInstallOnADeviceTarget()],
    });
    const wrongKind = await send("PUT", `/projects/${project.id}/test-targets`, {
      targets: [aHostedTarget({ key: "android" }), anInstallOnADeviceTarget()],
    });

    for (const response of [missing, wrongKind]) {
      expect(response.status).toBe(422);
      expect(projectRefusalSchema.parse(await response.json()).reasons).toEqual([
        expect.stringContaining(
          `android isn't one of «${project.name}»'s Build to install targets.`,
        ),
      ]);
    }
  });

  it("refuses an Install on a device target naming a device that is missing or no Android phone", async () => {
    const project = await addProject();
    hasDevices();

    for (const projectDeviceId of ["gone", "device-2"]) {
      const response = await send("PUT", `/projects/${project.id}/test-targets`, {
        targets: [aBuildToInstallTarget(), anInstallOnADeviceTarget({ projectDeviceId })],
      });

      expect(response.status).toBe(422);
      expect(projectRefusalSchema.parse(await response.json()).reasons).toEqual([
        expect.stringContaining(
          `${projectDeviceId} isn't an Android phone among «${project.name}»'s devices.`,
        ),
      ]);
    }
  });

  it("saves Hosted and Build to install targets set by you, a Secret variable's value never sent back", async () => {
    const project = await addProject();
    published.length = 0;

    const response = await send("PUT", `/projects/${project.id}/test-targets`, {
      targets: [aHostedTarget(), aBuildToInstallTarget()],
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("api-s3cret-value");
    const { targets } = testTargetListSchema.parse(JSON.parse(text));
    expect(targets).toEqual([
      {
        ...aHostedTarget(),
        secretVariables: [{ name: "API_KEY", valueSet: true }],
        setBy: {
          name: BY_YOU,
          kind: BY_YOU,
          entryPoint: BY_YOU,
          port: BY_YOU,
          variables: BY_YOU,
          secretVariables: BY_YOU,
          commandsBefore: BY_YOU,
          portVariable: BY_YOU,
          memoryMegabytes: BY_YOU,
        },
      },
      expect.objectContaining({ key: "android", kind: "build-to-install" }),
    ]);
    expect(webEvents()).toEqual([{ type: "project.test-targets-changed", projectId: project.id }]);

    const read = await fetch(`${url}/api/projects/${project.id}/test-targets`);
    const readText = await read.text();
    expect(readText).not.toContain("api-s3cret-value");
    expect(testTargetListSchema.parse(JSON.parse(readText)).targets).toEqual(targets);
  });

  it("keeps a Secret variable's value when it is sent without one", async () => {
    const project = await addProject();
    await send("PUT", `/projects/${project.id}/test-targets`, { targets: [aHostedTarget()] });

    const response = await send("PUT", `/projects/${project.id}/test-targets`, {
      targets: [aHostedTarget({ name: "Web", secretVariables: [{ name: "API_KEY" }] })],
    });

    expect(response.status).toBe(200);
    const [target] = testTargetListSchema.parse(await response.json()).targets;
    expect(target && "secretVariables" in target ? target.secretVariables : []).toEqual([
      { name: "API_KEY", valueSet: true },
    ]);
    expect(target?.name).toBe("Web");

    const again = await send("PUT", `/projects/${project.id}/test-targets`, {
      targets: [aHostedTarget({ name: "Web", secretVariables: [{ name: "API_KEY" }] })],
    });
    expect(again.status).toBe(200);
    expect(
      webEvents().filter(
        (event) => (event as { type: string }).type === "project.test-targets-changed",
      ),
    ).toHaveLength(2);
  });

  it("refuses a target breaking the page's rules or naming no entry point of the repository, saving nothing", async () => {
    const project = await addProject();

    const response = await send("PUT", `/projects/${project.id}/test-targets`, {
      targets: [
        aHostedTarget({ key: "Web", port: 70000 }),
        aBuildToInstallTarget({
          entryPoint: { kind: "repository-file", path: "scripts/missing.sh", arguments: [] },
        }),
      ],
    });

    expect(response.status).toBe(422);
    expect(projectRefusalSchema.parse(await response.json()).reasons).toEqual([
      `Test target "Web": A test target's key is lower-case letters, digits and "-", starting with a letter; "Web" is not.`,
      `Test target "Web": Its port must be a whole number from 1 to 65535.`,
    ]);

    const missingFile = await send("PUT", `/projects/${project.id}/test-targets`, {
      targets: [
        aBuildToInstallTarget({
          entryPoint: { kind: "repository-file", path: "scripts/missing.sh", arguments: [] },
        }),
      ],
    });
    expect(missingFile.status).toBe(422);
    expect(projectRefusalSchema.parse(await missingFile.json()).reasons).toEqual([
      `Test target "android": The repository has no file scripts/missing.sh.`,
    ]);
    const read = await fetch(`${url}/api/projects/${project.id}/test-targets`);
    expect(testTargetListSchema.parse(await read.json()).targets).toEqual([]);
    expect(webEvents()).not.toContainEqual(
      expect.objectContaining({ type: "project.test-targets-changed" }),
    );
  });
});

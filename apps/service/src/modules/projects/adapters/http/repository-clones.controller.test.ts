import { stat } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { repositoryCloneWebEventSchema } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import {
  gitIn,
  REAL_GIT_TEST,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";
import {
  aClonesRepository,
  HOST,
  repositoryClonesHttp,
} from "./repository-clones.controller.fixtures.js";
import { startProjectsApplication } from "../../projects.controller.fixtures.js";

let repository: TemporaryRepository;
let forgetMadeUpHost: () => void;
let officeData: string;
let app: INestApplication;
let url: string;
let published: DomainEvent[];

const { cloned, clonePath } = repositoryClonesHttp(() => ({ app, url, officeData }));

beforeAll(async () => {
  ({ repository, officeData, forget: forgetMadeUpHost } = await aClonesRepository());
});

afterAll(async () => {
  forgetMadeUpHost();
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

describe("POST /api/repositories/clones", REAL_GIT_TEST, () => {
  it("clones into the repositories folder, then tells the remote's branches", async () => {
    const clone = await cloned(`${HOST}origin`);

    expect(clone).toMatchObject({
      state: "cloned",
      url: `${HOST}origin`,
      path: clonePath("origin"),
      defaultBranch: "main",
      branches: ["main"],
    });
    expect(gitIn(clonePath("origin"), "rev-parse", "HEAD")).toBe(
      gitIn(repository.path, "rev-parse", "main"),
    );
    const forwarding = app.get(WebEventForwarding);
    const webEvents = published
      .map((event) => forwarding.toWebEvent(event))
      .filter((event) => event !== undefined)
      .map((event) => repositoryCloneWebEventSchema.parse(event));
    expect(webEvents.length).toBeGreaterThanOrEqual(2);
    expect(new Set(webEvents.map((event) => event.cloneId))).toEqual(new Set([clone.id]));
  });

  it("fails, leaving no folder, when the repository can't be read", async () => {
    const clone = await cloned(`${HOST}missing`);

    expect(clone).toMatchObject({
      state: "failed",
      // Told of the host git really reaches, after insteadOf.
      problem:
        "127.0.0.1 is reached anonymously over https, so only a public repository can be fetched.",
    });
    expect(await stat(clonePath("missing")).catch(() => undefined)).toBeUndefined();
  });
});

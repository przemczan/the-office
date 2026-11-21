import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  exitStatusOf,
  HEALTHY,
  serviceRootOf,
  serviceStartProblems,
  WEB_APP_TITLE,
  type ServiceStart,
} from "./service-start.ts";

const URL = "http://127.0.0.1:4392";
const PASSING: ServiceStart = {
  health: HEALTHY,
  page: `<html><head>${WEB_APP_TITLE}</head></html>`,
  exit: { code: null, signal: "SIGTERM" },
};

describe("serviceStartProblems", () => {
  it("finds none when the service is healthy, serves the web app and ends by SIGTERM", () => {
    assert.deepEqual(serviceStartProblems(PASSING, URL), []);
  });

  it("names a health answer other than the database up", () => {
    assert.deepEqual(serviceStartProblems({ ...PASSING, health: '{"database":"down"}' }, URL), [
      `Expected ${URL}/api/health to answer ${HEALTHY}, got '{"database":"down"}'.`,
    ]);
  });

  it("names a service started as a test instance of The Office", () => {
    const health = '{"database":"up","testInstance":true}';
    assert.deepEqual(serviceStartProblems({ ...PASSING, health }, URL), [
      `Expected ${URL}/api/health to answer ${HEALTHY}, got '${health}'.`,
    ]);
  });

  it("names a service that never answered, page and all", () => {
    assert.deepEqual(
      serviceStartProblems({ ...PASSING, health: undefined, page: undefined }, URL),
      [
        `Expected ${URL}/api/health to answer ${HEALTHY}, got no answer.`,
        `Expected ${URL}/ to serve the web app's page, got no answer.`,
      ],
    );
  });

  it("names a page that isn't the web app's", () => {
    assert.deepEqual(serviceStartProblems({ ...PASSING, page: "Not found" }, URL), [
      `Expected ${URL}/ to serve the web app's page, got 'Not found'.`,
    ]);
  });

  it("names any other end than SIGTERM's", () => {
    assert.deepEqual(serviceStartProblems({ ...PASSING, exit: { code: 0, signal: null } }, URL), [
      "The service ended with exit status 0 on SIGTERM, not 143.",
    ]);
  });
});

describe("exitStatusOf", () => {
  it("is the code a process ended with", () => {
    assert.equal(exitStatusOf({ code: 143, signal: null }), 143);
  });

  it("is 128 + 15 for an end by SIGTERM, as a shell shows it", () => {
    assert.equal(exitStatusOf({ code: null, signal: "SIGTERM" }), 143);
  });

  it("is the signal's name for any other signal", () => {
    assert.equal(exitStatusOf({ code: null, signal: "SIGKILL" }), "SIGKILL");
  });
});

describe("serviceRootOf", () => {
  it("checks the checkout's service, or the folder --root names", () => {
    assert.equal(serviceRootOf([], "/srv/checkout"), "/srv/checkout");
    assert.equal(
      serviceRootOf(["--root", "dist/release/the-office-1.2.3"], "/srv/checkout"),
      resolve("dist/release/the-office-1.2.3"),
    );
  });
});

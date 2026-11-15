import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { healthUrlOf } from "./service-health.ts";

describe("the health URL", () => {
  test("is loopback for an address meaning every interface, and brackets IPv6", () => {
    assert.equal(healthUrlOf({ OFFICE_PORT: "4310" }), "http://127.0.0.1:4310/api/health");
    assert.equal(
      healthUrlOf({ OFFICE_HOST: "0.0.0.0", OFFICE_PORT: "4310" }),
      "http://127.0.0.1:4310/api/health",
    );
    assert.equal(
      healthUrlOf({ OFFICE_HOST: "::", OFFICE_PORT: "4310" }),
      "http://127.0.0.1:4310/api/health",
    );
    assert.equal(
      healthUrlOf({ OFFICE_HOST: "::1", OFFICE_PORT: "4310" }),
      "http://[::1]:4310/api/health",
    );
    assert.equal(
      healthUrlOf({ OFFICE_HOST: "192.168.1.5", OFFICE_PORT: "80" }),
      "http://192.168.1.5:80/api/health",
    );
  });
});

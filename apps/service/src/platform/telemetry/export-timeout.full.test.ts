import { describe, expect, it } from "vitest";
import { exportTimeoutMilliseconds } from "./export-timeout.js";

describe("exportTimeoutMilliseconds", () => {
  it("takes OTEL_EXPORTER_OTLP_TIMEOUT, for a collector off this machine", () => {
    expect(exportTimeoutMilliseconds({ OTEL_EXPORTER_OTLP_TIMEOUT: "15000" })).toBe(15_000);
  });

  it.each([undefined, "", " ", "0", "-5", "soon"])(
    "keeps 2 seconds for the bundled Grafana when the timeout is %j",
    (timeout) => {
      expect(exportTimeoutMilliseconds({ OTEL_EXPORTER_OTLP_TIMEOUT: timeout })).toBe(2_000);
    },
  );
});

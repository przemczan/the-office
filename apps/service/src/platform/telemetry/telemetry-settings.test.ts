import type { TelemetryChoice } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { choiceToSave, savedChoiceOf } from "./telemetry-choice.js";
import {
  isSetByEnvironment,
  sameTelemetry,
  telemetrySettingsFrom,
  type TelemetryInEffect,
} from "./telemetry-settings.js";

const OWN: Extract<TelemetryChoice, { kind: "own-endpoint" }> = {
  kind: "own-endpoint",
  endpoint: "https://otlp.example.com",
  headers: [{ name: "Authorization", value: "Basic c2VjcmV0" }],
  timeoutMilliseconds: 5_000,
};

describe("telemetrySettingsFrom", () => {
  it("is off with neither a setting nor OTEL_* in the environment", () => {
    expect(telemetrySettingsFrom(undefined, {})).toEqual({ kind: "off", setByEnvironment: false });
  });

  it("is off when the setting says off", () => {
    expect(telemetrySettingsFrom({ kind: "off" }, {})).toEqual({
      kind: "off",
      setByEnvironment: false,
    });
  });

  it("exports to the bundled Grafana on this machine within 2 seconds", () => {
    expect(telemetrySettingsFrom({ kind: "bundled-grafana" }, {})).toEqual({
      kind: "export",
      endpoint: "http://127.0.0.1:4318",
      headers: [],
      timeoutMilliseconds: 2_000,
    });
  });

  it("exports to the user's own endpoint with its headers and timeout", () => {
    expect(telemetrySettingsFrom(OWN, {})).toEqual({
      kind: "export",
      endpoint: OWN.endpoint,
      headers: OWN.headers,
      timeoutMilliseconds: 5_000,
    });
  });

  it("gives the user's own endpoint the exporters' 10 seconds when it names no timeout", () => {
    const inEffect = telemetrySettingsFrom(
      { kind: "own-endpoint", endpoint: "https://otlp.example.com" },
      {},
    );
    expect(inEffect).toEqual({
      kind: "export",
      endpoint: "https://otlp.example.com",
      headers: [],
      timeoutMilliseconds: 10_000,
    });
  });

  it.each(["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS"])(
    "lets %s in the environment win over the setting, the SDK reading it",
    (variable) => {
      const inEffect = telemetrySettingsFrom(OWN, {
        [variable]: variable.endsWith("ENDPOINT") ? "http://collector:4318" : "x-key=1",
      });
      expect(inEffect.kind).toBe("environment");
      expect(isSetByEnvironment(inEffect)).toBe(true);
    },
  );

  it("tells the environment's endpoint, else the exporters' default, and its timeout", () => {
    expect(
      telemetrySettingsFrom(undefined, {
        OTEL_EXPORTER_OTLP_ENDPOINT: " http://collector:4318 ",
        OTEL_EXPORTER_OTLP_TIMEOUT: "15000",
      }),
    ).toEqual({
      kind: "environment",
      endpoint: "http://collector:4318",
      timeoutMilliseconds: 15_000,
    });
    expect(telemetrySettingsFrom(undefined, { OTEL_EXPORTER_OTLP_HEADERS: "a=b" })).toEqual({
      kind: "environment",
      endpoint: "http://localhost:4318",
      timeoutMilliseconds: 2_000,
    });
  });

  it("is off, set by the environment, when OTEL_SDK_DISABLED is true", () => {
    const inEffect = telemetrySettingsFrom(OWN, {
      OTEL_SDK_DISABLED: "TRUE",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
    });
    expect(inEffect).toEqual({ kind: "off", setByEnvironment: true });
    expect(isSetByEnvironment(inEffect)).toBe(true);
  });

  it("takes blank OTEL_* variables, and OTEL_EXPORTER_OTLP_TIMEOUT alone, as unset", () => {
    const inEffect = telemetrySettingsFrom(
      { kind: "bundled-grafana" },
      {
        OTEL_SDK_DISABLED: " ",
        OTEL_EXPORTER_OTLP_ENDPOINT: "",
        OTEL_EXPORTER_OTLP_TIMEOUT: "15000",
      },
    );
    expect(inEffect.kind).toBe("export");
    expect(isSetByEnvironment(inEffect)).toBe(false);
  });
});

describe("sameTelemetry", () => {
  const exported = telemetrySettingsFrom(OWN, {});

  it("tells a changed header value apart", () => {
    const changed: TelemetryInEffect = {
      ...(exported as Extract<TelemetryInEffect, { kind: "export" }>),
      headers: [{ name: "Authorization", value: "Basic b3RoZXI=" }],
    };
    expect(sameTelemetry(exported, telemetrySettingsFrom(OWN, {}))).toBe(true);
    expect(sameTelemetry(exported, changed)).toBe(false);
  });

  it("takes every off as the same", () => {
    expect(
      sameTelemetry(telemetrySettingsFrom(undefined, {}), { kind: "off", setByEnvironment: true }),
    ).toBe(true);
    expect(sameTelemetry(telemetrySettingsFrom(undefined, {}), exported)).toBe(false);
  });
});

describe("the own endpoint's Grafana", () => {
  const GRAFANA = { readAddress: "https://grafana.example.com", readToken: "glsa_read" };
  const SAVED: TelemetryChoice = { ...OWN, grafana: GRAFANA };

  it("saves the read address trimmed, without a trailing /, and the read token", () => {
    const { choice } = choiceToSave(
      {
        ...OWN,
        grafana: { readAddress: " https://grafana.example.com/ ", readToken: "glsa_read" },
      },
      undefined,
    );

    expect(choice).toMatchObject({ grafana: GRAFANA });
  });

  it.each(["ftp://grafana.example.com", "grafana.example.com", ""])(
    "refuses %j as a read address",
    (readAddress) => {
      const { problems } = choiceToSave({ ...OWN, grafana: { readAddress } }, undefined);

      expect(problems).toEqual([expect.stringContaining("Grafana read address")]);
    },
  );

  it("refuses a read token holding a line break", () => {
    const { problems } = choiceToSave(
      { ...OWN, grafana: { readAddress: GRAFANA.readAddress, readToken: "glsa\nX-Evil: 1" } },
      undefined,
    );

    expect(problems).toEqual(["The read token can't hold a line break."]);
  });

  it("keeps the saved read token when the token is sent empty or left out", () => {
    const changedAddress = { readAddress: "https://other.example.com" };

    expect(
      choiceToSave({ ...OWN, grafana: { ...changedAddress, readToken: "" } }, SAVED).choice,
    ).toMatchObject({ grafana: { ...changedAddress, readToken: "glsa_read" } });
    expect(choiceToSave({ ...OWN, grafana: changedAddress }, SAVED).choice).toMatchObject({
      grafana: { ...changedAddress, readToken: "glsa_read" },
    });
  });

  it("keeps the saved Grafana when it is left out, and removes it when sent null", () => {
    expect(choiceToSave(OWN, SAVED).choice).toMatchObject({ grafana: GRAFANA });
    expect(choiceToSave({ ...OWN, grafana: null }, SAVED).choice).not.toHaveProperty("grafana");
  });

  it("shows the browser whether a read token is saved, never the token", () => {
    const shown = savedChoiceOf(SAVED);

    expect(shown).toMatchObject({
      grafana: { readAddress: GRAFANA.readAddress, hasReadToken: true },
    });
    expect(JSON.stringify(shown)).not.toContain("glsa_read");
    expect(savedChoiceOf({ ...OWN, grafana: { readAddress: GRAFANA.readAddress } })).toMatchObject({
      grafana: { hasReadToken: false },
    });
  });

  it("exports alike with or without it, so it never waits for the next start", () => {
    expect(sameTelemetry(telemetrySettingsFrom(SAVED, {}), telemetrySettingsFrom(OWN, {}))).toBe(
      true,
    );
  });
});

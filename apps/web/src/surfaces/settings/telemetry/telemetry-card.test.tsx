import type { TelemetrySettings } from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  buttonNamed,
  closePage,
  openPage,
  stubService,
  typed,
  until,
} from "../../../shell/page.fixtures.tsx";
import { TelemetryCard } from "./telemetry-card.tsx";

const SECRET = "Basic c2VjcmV0LXRva2Vu";
const pages = { telemetry: TelemetryCard };

const OFF: TelemetrySettings = {
  saved: { kind: "off" },
  running: { kind: "off" },
  setByEnvironment: false,
  appliesAtNextStart: false,
  bundledGrafana: { state: "not-wanted", address: "http://localhost:3300", earlierStopped: [] },
};

function bundled(bundledGrafana: Partial<TelemetrySettings["bundledGrafana"]>): TelemetrySettings {
  return {
    ...OFF,
    saved: { kind: "bundled-grafana" },
    appliesAtNextStart: true,
    bundledGrafana: { ...OFF.bundledGrafana, ...bundledGrafana },
  };
}

afterEach(closePage);

function radio(page: HTMLElement, label: string): HTMLInputElement {
  const found = [...page.querySelectorAll<HTMLLabelElement>(".radio-list-item")].find((each) =>
    each.textContent?.startsWith(label),
  );
  const choice = found?.querySelector("input");
  if (!choice) throw new Error(`No choice ${label}.`);
  return choice;
}

function input(page: HTMLElement, label: string): HTMLInputElement {
  const found = [...page.querySelectorAll("label")].find(
    (each) => each.textContent?.replace("*", "").trim() === label,
  );
  const field = found && page.ownerDocument.getElementById(found.htmlFor);
  if (!(field instanceof HTMLInputElement)) throw new Error(`No input labelled ${label}.`);
  return field;
}

describe("the Telemetry card", () => {
  it("offers Off, Bundled Grafana and an own endpoint, and says when a choice applies", async () => {
    stubService({ "GET /api/settings/telemetry": () => ({ status: 200, body: OFF }) });
    const { page } = await openPage("/telemetry", pages);
    await until(() => expect(page.textContent).toContain("Now: telemetry is off."));

    expect(radio(page, "Off").checked).toBe(true);
    expect(radio(page, "Bundled Grafana").checked).toBe(false);
    expect(radio(page, "Your own endpoint").checked).toBe(false);
    expect(page.textContent).toContain("Applies the next time The Office starts.");
    expect(page.textContent).not.toContain("Endpoint URL");
  });

  it("saves the bundled Grafana", async () => {
    let current = OFF;
    const sent = stubService({
      "GET /api/settings/telemetry": () => ({ status: 200, body: current }),
      "PUT /api/settings/telemetry": () => {
        current = bundled({ state: "starting" });
        return { status: 200, body: current };
      },
    });
    const { page } = await openPage("/telemetry", pages);
    await until(() => expect(buttonNamed(page, "Save")).toBeDefined());

    act(() => radio(page, "Bundled Grafana").click());
    act(() => buttonNamed(page, "Save")?.click());

    await until(() => expect(page.textContent).toContain("Saved, not running yet"));
    expect(page.ownerDocument.body.textContent).toContain(
      "the bundled Grafana is starting, and The Office exports to it from its next start.",
    );
    expect(sent.find(({ request }) => request === "PUT /api/settings/telemetry")?.body).toEqual({
      kind: "bundled-grafana",
    });
  });

  it("saves an own endpoint with a header, and shows a saved header by its name alone", async () => {
    let current = OFF;
    const sent = stubService({
      "GET /api/settings/telemetry": () => ({ status: 200, body: current }),
      "PUT /api/settings/telemetry": () => {
        current = {
          ...OFF,
          saved: {
            kind: "own-endpoint",
            endpoint: "https://otlp.example.com",
            headerNames: ["Authorization"],
          },
          appliesAtNextStart: true,
        };
        return { status: 200, body: current };
      },
    });
    const { page } = await openPage("/telemetry", pages);
    await until(() => expect(buttonNamed(page, "Save")).toBeDefined());

    act(() => radio(page, "Your own endpoint").click());
    typed(page, "Endpoint URL", "https://otlp.example.com");
    act(() => buttonNamed(page, "Add a header")?.click());
    typed(page, "Header 1 name", "Authorization");
    typed(page, "Header 1 value", SECRET);
    act(() => buttonNamed(page, "Save")?.click());

    await until(() => expect(page.textContent).toContain("Saved, never shown"));
    expect(sent.find(({ request }) => request === "PUT /api/settings/telemetry")?.body).toEqual({
      kind: "own-endpoint",
      endpoint: "https://otlp.example.com",
      headers: [{ name: "Authorization", value: SECRET }],
    });
    expect(input(page, "Header 1 name").value).toBe("Authorization");
    expect(input(page, "Header 1 value").value).toBe("");
    expect(page.innerHTML).not.toContain(SECRET);
  });

  it("keeps a saved header's value by sending it empty", async () => {
    const sent = stubService({
      "GET /api/settings/telemetry": () => ({
        status: 200,
        body: {
          ...OFF,
          saved: {
            kind: "own-endpoint",
            endpoint: "https://otlp.example.com",
            headerNames: ["Authorization"],
            timeoutMilliseconds: 5_000,
          },
        },
      }),
      "PUT /api/settings/telemetry": (body) => ({ status: 200, body: { ...OFF, saved: body } }),
    });
    const { page } = await openPage("/telemetry", pages);
    await until(() => expect(input(page, "Header 1 name").value).toBe("Authorization"));

    expect(input(page, "Export timeout").value).toBe("5000");
    act(() => buttonNamed(page, "Save")?.click());

    await until(() =>
      expect(sent.find(({ request }) => request === "PUT /api/settings/telemetry")?.body).toEqual({
        kind: "own-endpoint",
        endpoint: "https://otlp.example.com",
        headers: [{ name: "Authorization", value: "" }],
        timeoutMilliseconds: 5_000,
      }),
    );
  });

  it("shows the service's reasons when it refuses", async () => {
    stubService({
      "GET /api/settings/telemetry": () => ({ status: 200, body: OFF }),
      "PUT /api/settings/telemetry": () => ({
        status: 422,
        body: {
          message: "The endpoint must be an http:// or https:// address.",
          reasons: ["The endpoint must be an http:// or https:// address."],
        },
      }),
    });
    const { page } = await openPage("/telemetry", pages);
    await until(() => expect(buttonNamed(page, "Save")).toBeDefined());

    act(() => radio(page, "Your own endpoint").click());
    typed(page, "Endpoint URL", "otlp.example.com");
    act(() => buttonNamed(page, "Save")?.click());

    await until(() => expect(page.textContent).toContain("Telemetry wasn't saved"));
    expect(page.textContent).toContain("http:// or https://");
  });

  it("is read-only and says so while the environment sets telemetry", async () => {
    stubService({
      "GET /api/settings/telemetry": () => ({
        status: 200,
        body: {
          saved: { kind: "bundled-grafana" },
          running: { kind: "exporting", endpoint: "http://collector:4318" },
          setByEnvironment: true,
          appliesAtNextStart: false,
          bundledGrafana: OFF.bundledGrafana,
        },
      }),
    });
    const { page } = await openPage("/telemetry", pages);
    await until(() => expect(page.textContent).toContain("The environment sets telemetry"));

    expect(page.textContent).toContain("OTEL_ variables in .env");
    expect(page.textContent).toContain("Now: exporting to http://collector:4318.");
    expect(buttonNamed(page, "Save")).toBeUndefined();
    expect(page.querySelectorAll("input")).toHaveLength(0);
  });

  describe("the bundled Grafana's state", () => {
    it("says it is starting, and that the first start can take minutes", async () => {
      stubService({
        "GET /api/settings/telemetry": () => ({
          status: 200,
          body: bundled({ state: "starting" }),
        }),
      });
      const { page } = await openPage("/telemetry", pages);
      await until(() => expect(page.textContent).toContain("Bundled Grafana: Starting…"));

      expect(page.textContent).toContain("can take a few minutes");
      expect(page.textContent).not.toContain("Open Grafana");
    });

    it("says it is running, with a link that opens it in a new tab", async () => {
      stubService({
        "GET /api/settings/telemetry": () => ({ status: 200, body: bundled({ state: "running" }) }),
      });
      const { page } = await openPage("/telemetry", pages);
      await until(() => expect(page.textContent).toContain("Bundled Grafana: Running"));

      const link = [...page.querySelectorAll("a")].find(
        (each) => each.textContent === "Open Grafana",
      );
      expect(link?.getAttribute("href")).toBe("http://localhost:3300");
      expect(link?.getAttribute("target")).toBe("_blank");
    });

    it("says why it couldn't start, and Try again starts it once more", async () => {
      const sent = stubService({
        "GET /api/settings/telemetry": () => ({
          status: 200,
          body: bundled({ state: "failed", problem: "Docker isn't running on this computer." }),
        }),
        "POST /api/settings/telemetry/bundled-grafana/start": () => ({
          status: 200,
          body: bundled({ state: "starting" }),
        }),
      });
      const { page } = await openPage("/telemetry", pages);
      await until(() => expect(page.textContent).toContain("Bundled Grafana: Couldn't start"));

      expect(page.textContent).toContain("Docker isn't running on this computer.");
      act(() => buttonNamed(page, "Try again")?.click());

      await until(() => expect(page.textContent).toContain("Bundled Grafana: Starting…"));
      expect(
        sent.filter(
          ({ request }) => request === "POST /api/settings/telemetry/bundled-grafana/start",
        ),
      ).toHaveLength(1);
      expect(buttonNamed(page, "Try again")).toBeUndefined();
    });

    it("names the earlier bundled Grafana The Office stopped", async () => {
      stubService({
        "GET /api/settings/telemetry": () => ({
          status: 200,
          body: bundled({ state: "running", earlierStopped: ["office-grafana", "lgtm"] }),
        }),
      });
      const { page } = await openPage("/telemetry", pages);
      await until(() => expect(page.textContent).toContain("Bundled Grafana: Running"));

      expect(page.textContent).toContain(
        "The Office stopped the earlier bundled Grafana (office-grafana, lgtm)",
      );
      expect(page.textContent).toContain("kept, not removed");
    });

    it("shows nothing for Off or an own endpoint, nor while Bundled Grafana is only picked", async () => {
      stubService({
        "GET /api/settings/telemetry": () => ({
          status: 200,
          body: {
            ...OFF,
            saved: { kind: "own-endpoint", endpoint: "https://otlp.example.com", headerNames: [] },
            bundledGrafana: { ...OFF.bundledGrafana, state: "running" },
          },
        }),
      });
      const { page } = await openPage("/telemetry", pages);
      await until(() => expect(page.textContent).toContain("Endpoint URL"));

      expect(page.textContent).not.toContain("Bundled Grafana:");
      act(() => radio(page, "Bundled Grafana").click());
      expect(page.textContent).not.toContain("Bundled Grafana:");
      act(() => radio(page, "Off").click());
      expect(page.textContent).not.toContain("Bundled Grafana:");
    });
  });
});

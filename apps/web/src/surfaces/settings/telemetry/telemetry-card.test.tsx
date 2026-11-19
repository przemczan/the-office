import type { OfficeUpdate, TelemetrySettings } from "@the-office/contracts";
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

const READ_TOKEN = "glsa_secret-read-token";

function ownEndpoint(grafana?: { readAddress: string; hasReadToken: boolean }): TelemetrySettings {
  return {
    ...OFF,
    saved: {
      kind: "own-endpoint",
      endpoint: "https://otlp.example.com",
      headerNames: [],
      ...(grafana && { grafana }),
    },
    running: { kind: "exporting", endpoint: "https://otlp.example.com" },
  };
}

const SAVED_GRAFANA = { readAddress: "https://grafana.example.com", hasReadToken: true };

function statsGroup(page: HTMLElement): HTMLElement | null {
  return page.querySelector<HTMLElement>(".telemetry-stats");
}

describe("the Telemetry card's Stats group", () => {
  it("shows only with Your own endpoint picked, and says when each part applies", async () => {
    stubService({ "GET /api/settings/telemetry": () => ({ status: 200, body: OFF }) });
    const { page } = await openPage("/telemetry", pages);
    await until(() => expect(buttonNamed(page, "Save")).toBeDefined());

    expect(statsGroup(page)).toBeNull();
    act(() => radio(page, "Bundled Grafana").click());
    expect(statsGroup(page)).toBeNull();
    act(() => radio(page, "Your own endpoint").click());

    expect(statsGroup(page)?.textContent).toContain("Where Stats reads the full stats from.");
    expect(input(page, "Grafana read address").placeholder).toBe("https://grafana.example.com");
    expect(input(page, "Read token").type).toBe("password");
    expect(page.textContent).toContain("A Viewer service account token, made in Grafana");
    expect(restartNote(page)).toContain(
      "Export settings apply the next time The Office starts. Stats' read address and token apply as soon as they're saved.",
    );
    expect(buttonNamed(page, "Remove")).toBeUndefined();
    const test = buttonNamed(page, "Test");
    expect(test?.disabled).toBe(true);
    expect(test?.title).toBe("Give the Grafana read address to test it.");
  });

  it("saves the read address and token with the own endpoint", async () => {
    let current = OFF;
    const sent = stubService({
      "GET /api/settings/telemetry": () => ({ status: 200, body: current }),
      "PUT /api/settings/telemetry": () => {
        current = ownEndpoint(SAVED_GRAFANA);
        return { status: 200, body: current };
      },
    });
    const { page } = await openPage("/telemetry", pages);
    await until(() => expect(buttonNamed(page, "Save")).toBeDefined());

    act(() => radio(page, "Your own endpoint").click());
    typed(page, "Endpoint URL", "https://otlp.example.com");
    typed(page, "Grafana read address", "https://grafana.example.com");
    typed(page, "Read token", READ_TOKEN);
    act(() => buttonNamed(page, "Save")?.click());

    await until(() => expect(input(page, "Read token").placeholder).toBe("Saved"));
    expect(sent.find(({ request }) => request === "PUT /api/settings/telemetry")?.body).toEqual({
      kind: "own-endpoint",
      endpoint: "https://otlp.example.com",
      headers: [],
      grafana: { readAddress: "https://grafana.example.com", readToken: READ_TOKEN },
    });
    expect(input(page, "Grafana read address").value).toBe("https://grafana.example.com");
    expect(input(page, "Read token").value).toBe("");
    expect(page.textContent).toContain("Saved, never shown. Leave it empty to keep it.");
    expect(page.innerHTML).not.toContain(READ_TOKEN);
  });

  it("keeps the saved read token by leaving it out while its field is empty", async () => {
    const sent = stubService({
      "GET /api/settings/telemetry": () => ({ status: 200, body: ownEndpoint(SAVED_GRAFANA) }),
      "PUT /api/settings/telemetry": () => ({ status: 200, body: ownEndpoint(SAVED_GRAFANA) }),
    });
    const { page } = await openPage("/telemetry", pages);
    await until(() => expect(input(page, "Read token").placeholder).toBe("Saved"));

    typed(page, "Grafana read address", "https://grafana.example.org");
    act(() => buttonNamed(page, "Save")?.click());

    await until(() =>
      expect(sent.find(({ request }) => request === "PUT /api/settings/telemetry")?.body).toEqual({
        kind: "own-endpoint",
        endpoint: "https://otlp.example.com",
        headers: [],
        grafana: { readAddress: "https://grafana.example.org" },
      }),
    );
  });

  it("removes the saved Grafana when its read address is emptied", async () => {
    const sent = stubService({
      "GET /api/settings/telemetry": () => ({ status: 200, body: ownEndpoint(SAVED_GRAFANA) }),
      "PUT /api/settings/telemetry": () => ({ status: 200, body: ownEndpoint() }),
    });
    const { page } = await openPage("/telemetry", pages);
    await until(() => expect(input(page, "Read token").placeholder).toBe("Saved"));

    typed(page, "Grafana read address", "");
    act(() => buttonNamed(page, "Save")?.click());

    await until(() =>
      expect(
        sent.find(({ request }) => request === "PUT /api/settings/telemetry")?.body,
      ).toMatchObject({ kind: "own-endpoint", grafana: null }),
    );
  });

  it("Remove saves the own endpoint with no Grafana and empties the fields", async () => {
    let current = ownEndpoint(SAVED_GRAFANA);
    const sent = stubService({
      "GET /api/settings/telemetry": () => ({ status: 200, body: current }),
      "PUT /api/settings/telemetry": () => {
        current = ownEndpoint();
        return { status: 200, body: current };
      },
    });
    const { page } = await openPage("/telemetry", pages);
    await until(() => expect(buttonNamed(page, "Remove")).toBeDefined());

    act(() => buttonNamed(page, "Remove")?.click());

    await until(() => expect(buttonNamed(page, "Remove")).toBeUndefined());
    expect(sent.find(({ request }) => request === "PUT /api/settings/telemetry")?.body).toEqual({
      kind: "own-endpoint",
      endpoint: "https://otlp.example.com",
      grafana: null,
    });
    expect(input(page, "Grafana read address").value).toBe("");
    expect(input(page, "Read token").placeholder).toBe("");
  });

  it.each([
    [
      { state: "reachable", prometheus: "grafanacloud-prom", loki: "grafanacloud-logs" },
      "Grafana answered at https://grafana.example.com.",
      "Found Prometheus “grafanacloud-prom” and Loki “grafanacloud-logs”.",
    ],
    [{ state: "rejected" }, "Grafana refused the read token.", ""],
    [
      { state: "unreachable", problem: "no answer within 10 seconds." },
      "Couldn't reach Grafana at https://grafana.example.com: no answer within 10 seconds.",
      "",
    ],
    [
      { state: "no-data-sources", missing: ["loki"] },
      "Grafana answered at https://grafana.example.com, but it has no Loki data source the token can query.",
      "",
    ],
    [
      { state: "no-data-sources", missing: ["prometheus", "loki"] },
      "Grafana answered at https://grafana.example.com, but it has no Prometheus and Loki data sources the token can query.",
      "",
    ],
  ])("Test says what the check found: %o", async (answer, title, text) => {
    const sent = stubService({
      "GET /api/settings/telemetry": () => ({ status: 200, body: ownEndpoint() }),
      "POST /api/stats/grafana-check": () => ({ status: 200, body: answer }),
    });
    const { page } = await openPage("/telemetry", pages);
    await until(() => expect(buttonNamed(page, "Test")).toBeDefined());

    typed(page, "Grafana read address", " https://grafana.example.com ");
    typed(page, "Read token", READ_TOKEN);
    act(() => buttonNamed(page, "Test")?.click());

    await until(() => expect(statsGroup(page)?.textContent).toContain(title));
    expect(statsGroup(page)?.textContent).toContain(text);
    expect(sent.find(({ request }) => request === "POST /api/stats/grafana-check")?.body).toEqual({
      readAddress: "https://grafana.example.com",
      readToken: READ_TOKEN,
    });
    expect(sent.map(({ request }) => request)).not.toContain("PUT /api/settings/telemetry");
  });

  it("Test uses the saved read token while its field is empty", async () => {
    const sent = stubService({
      "GET /api/settings/telemetry": () => ({ status: 200, body: ownEndpoint(SAVED_GRAFANA) }),
      "POST /api/stats/grafana-check": () => ({
        status: 200,
        body: { state: "reachable", prometheus: "Prometheus", loki: "Loki" },
      }),
    });
    const { page } = await openPage("/telemetry", pages);
    await until(() => expect(buttonNamed(page, "Test")?.disabled).toBe(false));

    act(() => buttonNamed(page, "Test")?.click());

    await until(() => expect(statsGroup(page)?.textContent).toContain("Grafana answered at"));
    expect(sent.find(({ request }) => request === "POST /api/stats/grafana-check")?.body).toEqual({
      readAddress: "https://grafana.example.com",
    });
  });

  it("isn't there while the environment sets telemetry", async () => {
    stubService({
      "GET /api/settings/telemetry": () => ({
        status: 200,
        body: { ...ownEndpoint(SAVED_GRAFANA), setByEnvironment: true },
      }),
    });
    const { page } = await openPage("/telemetry", pages);
    await until(() => expect(page.textContent).toContain("The environment sets telemetry"));

    expect(statsGroup(page)).toBeNull();
    expect(page.querySelectorAll("input")).toHaveLength(0);
    expect(buttonNamed(page, "Test")).toBeUndefined();
    expect(buttonNamed(page, "Remove")).toBeUndefined();
  });
});

const OFFICE_UPDATE: OfficeUpdate = {
  install: "checkout",
  current: {
    commit: "0123456789abcdef0123456789abcdef01234567",
    shortCommit: "0123456",
    subject: "Add Settings › Updates",
    committedAt: "2026-11-14T09:00:00.000Z",
  },
  restart: {},
  checking: false,
};

const SAVED_NOT_RUNNING = bundled({ state: "running" });

function restartNote(page: HTMLElement): string {
  return page.querySelector(".telemetry-actions-state")?.textContent ?? "";
}

describe("the Telemetry card's Restart The Office", () => {
  it("restarts The Office beside the note while what is saved isn't running", async () => {
    let officeUpdate = OFFICE_UPDATE;
    const sent = stubService({
      "GET /api/settings/telemetry": () => ({ status: 200, body: SAVED_NOT_RUNNING }),
      "GET /api/office-update": () => ({ status: 200, body: officeUpdate }),
      "POST /api/office-restart/schedule": () => {
        officeUpdate = {
          ...OFFICE_UPDATE,
          scheduled: { kind: "restart", scheduledAt: "2026-11-15T09:00:00.000Z", busy: [] },
        };
        return { status: 204 };
      },
    });
    const { page } = await openPage("/telemetry", pages);
    await until(() => expect(buttonNamed(page, "Restart The Office")).toBeDefined());

    expect(restartNote(page)).toContain("Applies the next time The Office starts.");
    expect(
      page
        .querySelector(".telemetry-actions-state")
        ?.contains(buttonNamed(page, "Restart The Office") ?? null),
    ).toBe(true);
    act(() => buttonNamed(page, "Restart The Office")?.click());

    await until(() => expect(restartNote(page)).toContain("A restart is scheduled."));
    expect(sent.map(({ request }) => request)).toContain("POST /api/office-restart/schedule");
    expect(sent.map(({ request }) => request)).not.toContain("PUT /api/settings/telemetry");
    expect(page.querySelector(".telemetry-actions-state a")?.getAttribute("href")).toBe(
      "/settings/updates",
    );
  });

  it("offers no restart while what is saved runs", async () => {
    const sent = stubService({
      "GET /api/settings/telemetry": () => ({ status: 200, body: OFF }),
      "GET /api/office-update": () => ({ status: 200, body: OFFICE_UPDATE }),
    });
    const { page } = await openPage("/telemetry", pages);
    await until(() => expect(buttonNamed(page, "Save")).toBeDefined());

    expect(buttonNamed(page, "Restart The Office")).toBeUndefined();
    expect(sent.map(({ request }) => request)).not.toContain("GET /api/office-update");
  });

  it("says why The Office can't restart instead of the button", async () => {
    const refusal =
      "Nothing here would start The Office again: it runs without its launcher. Restart it where it runs.";
    stubService({
      "GET /api/settings/telemetry": () => ({ status: 200, body: SAVED_NOT_RUNNING }),
      "GET /api/office-update": () => ({
        status: 200,
        body: { ...OFFICE_UPDATE, restart: { refusal } },
      }),
    });
    const { page } = await openPage("/telemetry", pages);
    await until(() => expect(restartNote(page)).toContain(refusal));

    expect(buttonNamed(page, "Restart The Office")).toBeUndefined();
  });

  it("says a scheduled update applies it, with a link to Settings › Updates", async () => {
    stubService({
      "GET /api/settings/telemetry": () => ({ status: 200, body: SAVED_NOT_RUNNING }),
      "GET /api/office-update": () => ({
        status: 200,
        body: {
          ...OFFICE_UPDATE,
          restart: { refusal: "An update is scheduled already; it starts The Office again too." },
          scheduled: {
            kind: "update",
            target: { ...OFFICE_UPDATE.current, kind: "commit" },
            scheduledAt: "2026-11-15T09:00:00.000Z",
            busy: [],
          },
        },
      }),
    });
    const { page } = await openPage("/telemetry", pages);
    await until(() =>
      expect(restartNote(page)).toContain(
        "An update is scheduled; it applies this as The Office starts again.",
      ),
    );

    expect(buttonNamed(page, "Restart The Office")).toBeUndefined();
    expect(page.querySelector(".telemetry-actions-state a")?.textContent).toBe(
      "Settings › Updates",
    );
  });
});

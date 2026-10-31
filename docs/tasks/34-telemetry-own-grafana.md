# 34 · Telemetry: the bundled `otel-lgtm` optional, the user's own Grafana or collector

Status: done

## Goal

The user chooses where The Office's traces, metrics and logs go: to the bundled `otel-lgtm`, as today, or to their own Grafana or OpenTelemetry collector, where they build their own dashboards. Without the bundled one, `docker compose up -d` starts Postgres alone.

## Definition of Done

- [x] The bundled `otel-lgtm` sits behind a compose profile that `.env.example` turns on, so a fresh copy behaves as today; with it off, `docker compose up -d` starts Postgres alone and `npm run verify:linux` still runs. Check: `docker compose ps` both ways; `npm run verify:linux` with the profile off.
- [x] The service exports to any OTLP over HTTP endpoint the standard `OTEL_*` variables name, with their headers and timeout; its 2-second export timeout applies only when no timeout is set. Check: a service test of the timeout chosen; `npm run verify`.
- [x] Seen once live: the service sends to a second `otel-lgtm` standing in for the user's own Grafana, with the bundled one off, and the health request's trace is in that Grafana; `.env.example` says how to switch and how to send nowhere (`OTEL_SDK_DISABLED`). Check: the trace looked up in the stand-in's Tempo, summarised in State.

## Read first

- [Spec §5.2](../spec/5.2-stack.md): the infrastructure line this task builds.
- The [platform map](../../apps/service/src/platform/MAP.md): `config/` and `telemetry/`.

Leave out: dashboards (the user builds their own); OTLP over gRPC and a choice of protocol; a Settings page for telemetry (it stays in `.env`, read at start); the other tier 3 tasks; the phone (after tier 3).

Decided with the user on 2026-10-31: the bundled `otel-lgtm` stays the default and becomes optional; the user can point The Office at their own Grafana or collector.

## Steps

- [x] 0. Write this file and link it from the README. Commit.
- [x] 1. Compose: `otel-lgtm` behind a profile, turned on by `COMPOSE_PROFILES` in `.env.example`; `verify-linux` no longer needs it; `.env.example` explains the three choices (bundled, own endpoint with its headers, none). Commit.
  Read: `docker-compose.yml`; `.env.example`; `tools/verify-linux/verify-linux.sh` (what it needs from the stack).
- [x] 2. The service: the export timeout from `OTEL_EXPORTER_OTLP_TIMEOUT` when set, 2 seconds otherwise, with a test; the live check against a stand-in Grafana; close the task. Commit.
  Read: `apps/service/src/platform/telemetry/start-telemetry.ts`, `telemetry.test.ts`.

## State

- Done. Step 1: `otel-lgtm` has the `grafana` compose profile, on through `COMPOSE_PROFILES=grafana` in `.env.example` (added to the workstation's `.env` too, so its stack is unchanged); `verify-linux` depends on it with `required: false`; `COMPOSE_PROFILES` is one of The Office's own variables, so a Project's own `docker compose` never inherits it. `.env.example` explains the bundled Grafana, an own endpoint with `OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_EXPORTER_OTLP_TIMEOUT`, and `OTEL_SDK_DISABLED`.
- Step 2: `exportTimeoutMilliseconds` (`platform/telemetry/export-timeout.ts`) takes `OTEL_EXPORTER_OTLP_TIMEOUT` when it is a positive number, else 2 seconds; `startTelemetry` gives it to the exporters and processors, and stretches the metric interval to it, since the reader refuses a timeout longer than its interval. The general variable only: the per-signal ones (`..._TRACES_TIMEOUT`) are overridden.
- Live check (2026-10-31, Windows): a Postgres-only compose project (`-p office34check`, profile off) and a second `otel-lgtm` on 3390/4390 standing in for the user's Grafana; the service on 4391 with the endpoint on 4390 and a 15-second timeout; the `GET /api/health` trace `e636e2dc…` found in the stand-in's Tempo. With `OTEL_SDK_DISABLED=true` the service started and served health with no export errors. Everything removed after; port 4391 free.
- `npm run verify` and `npm run verify:linux` pass, the latter also with the profile off (step 1).

## Progress

The log is in [archive/34-telemetry-own-grafana.md](archive/34-telemetry-own-grafana.md).

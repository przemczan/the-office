# 02 · Foundation: workspace, service, database, events, telemetry

Status: done

## Goal

The skeleton every module grows in: the NestJS service on `localhost`, Postgres and `otel-lgtm` in Docker, Drizzle migrations, the domain-event bus with WebSocket push, OpenTelemetry, the contracts package, and one `npm run verify`. No business module yet: task 04 builds the first one on this template.

## Definition of Done

- [x] `docker compose up -d` starts Postgres and `grafana/otel-lgtm` (both images pinned by tag). Check: `docker compose ps` shows both healthy.
- [x] `npm run dev` starts the service on `localhost` only, runs pending migrations, and serves `GET /api/health` with the database state. Check: `curl http://localhost:<port>/api/health`; the port is refused from another machine on the LAN.
- [x] A domain event emitted inside the service reaches a connected browser over WebSocket, typed by `packages/contracts`. Check: the integration test for the event bus and gateway.
- [x] Traces, metrics and logs arrive in `otel-lgtm`. Check: the health request's trace is visible in Grafana's Tempo view.
- [x] `npm run verify` runs typecheck, oxlint, Prettier check and Vitest across the workspace, and passes. Check: run it.
- [x] `npm run verify:linux` runs the same checks in a `node:22` container against the working tree, and passes; the service starts there against the compose Postgres. Check: run it on the workstation.
- [x] The platform layer `src/platform/os/` is the only code that branches on the operating system: the data directory default, path joining and length rules, the default shell. Check: a lint rule refuses `process.platform` outside it.
- [x] The layering rules are enforced, not just written: a module importing another module's `domain/` or `adapters/`, or the web importing the service, fails `npm run verify`. Check: add such an import and see it fail.

## Read first

- [Spec §5](../spec/README.md#5-architecture-and-stack) and [Build defaults](README.md#build-defaults).
- [research/factory-reference.md](../../.scratch/the-office/research/factory-reference.md) §10 (settings layers; the merge mechanism is reusable, the schema is not) and §12 (costs to avoid: the god object and the snapshot grab-bag).

## Steps

- [x] 1. Workspace tooling: `.gitattributes` with `* text=auto eol=lf` (the checkout converts to CRLF otherwise, and Prettier expects LF), TypeScript strict in `tsconfig.base.json`, oxlint and Prettier configs, Vitest workspace config, and the root `verify` script. Confirm the chosen TypeScript version emits decorator metadata for Nest (`experimentalDecorators`, `emitDecoratorMetadata`), and that Vitest runs Nest code through SWC. Commit.
- [x] 2. `docker-compose.yml` with Postgres and `grafana/otel-lgtm`, a `.env.example` with the database URL and `OFFICE_DATA_DIR`, and typed config loading in the service that refuses to start on a missing value. Commit.
- [x] 3. `apps/service`: NestJS bound to `127.0.0.1`, `src/platform/` with config and the database (Drizzle, a migrations folder, migrate on start), and `GET /api/health`. Commit.
- [x] 4. Domain events: a typed in-process event bus in `src/platform/events/`, a WebSocket gateway that forwards the events the web subscribes to, and their schemas in `packages/contracts`. Commit.
- [x] 5. Telemetry in `src/platform/telemetry/`: the OpenTelemetry SDK with OTLP export of traces, metrics and logs, HTTP and database instrumentation, and a helper modules use for their own spans and token metrics. Commit.
- [x] 6. Layering rules: lint rules (oxlint `no-restricted-imports` or a dependency check) that keep each module's internals private and its dependencies pointing inward (adapters → application → domain), and keep `apps/web` off `apps/service`. Write the module layout and these rules into `apps/service/README.md` as the module template. Commit.
- [x] 7. The platform layer in `src/platform/os/` with Windows and Linux implementations of the data directory, paths and default shell, tests for both run on each platform, and `npm run verify:linux` (a `node:22` container with the repository mounted read-only and its own `node_modules`). Commit.
- [x] 8. Test support: a Vitest setup that runs repository tests against a throwaway Postgres database (migrated per run) and a helper to boot a Nest testing module. Commit.

## Progress

The log is archived in [archive/02-foundation.md](archive/02-foundation.md).

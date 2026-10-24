# 02 · Foundation: workspace, service, database, events, telemetry

Status: todo

## Goal

The skeleton every module grows in: the NestJS service on `localhost`, Postgres and `otel-lgtm` in Docker, Drizzle migrations, the domain-event bus with WebSocket push, OpenTelemetry, the contracts package, and one `npm run verify`. No business module yet: task 04 builds the first one on this template.

## Definition of Done

- [ ] `docker compose up -d` starts Postgres and `grafana/otel-lgtm` (both images pinned by tag). Check: `docker compose ps` shows both healthy.
- [ ] `npm run dev` starts the service on `localhost` only, runs pending migrations, and serves `GET /api/health` with the database state. Check: `curl http://localhost:<port>/api/health`; the port is refused from another machine on the LAN.
- [ ] A domain event emitted inside the service reaches a connected browser over WebSocket, typed by `packages/contracts`. Check: the integration test for the event bus and gateway.
- [ ] Traces, metrics and logs arrive in `otel-lgtm`. Check: the health request's trace is visible in Grafana's Tempo view.
- [ ] `npm run verify` runs typecheck, oxlint, Prettier check and Vitest across the workspace, and passes. Check: run it.
- [ ] The layering rules are enforced, not just written: a module importing another module's `domain/` or `adapters/`, or the web importing the service, fails `npm run verify`. Check: add such an import and see it fail.

## Read first

- [Spec §5](../spec.md#5-architecture-and-stack) and [Build defaults](README.md#build-defaults).
- [research/factory-reference.md](../../.scratch/the-office/research/factory-reference.md) §10 (settings layers; the merge mechanism is reusable, the schema is not) and §12 (costs to avoid: the god object and the snapshot grab-bag).

## Steps

- [ ] 1. Workspace tooling: `.gitattributes` with `* text=auto eol=lf` (the checkout converts to CRLF otherwise, and Prettier expects LF), TypeScript strict in `tsconfig.base.json`, oxlint and Prettier configs, Vitest workspace config, and the root `verify` script. Confirm the chosen TypeScript version emits decorator metadata for Nest (`experimentalDecorators`, `emitDecoratorMetadata`), and that Vitest runs Nest code through SWC. Commit.
- [ ] 2. `docker-compose.yml` with Postgres and `grafana/otel-lgtm`, a `.env.example` with the database URL and `OFFICE_DATA_DIR`, and typed config loading in the service that refuses to start on a missing value. Commit.
- [ ] 3. `apps/service`: NestJS bound to `127.0.0.1`, `src/platform/` with config and the database (Drizzle, a migrations folder, migrate on start), and `GET /api/health`. Commit.
- [ ] 4. Domain events: a typed in-process event bus in `src/platform/events/`, a WebSocket gateway that forwards the events the web subscribes to, and their schemas in `packages/contracts`. Commit.
- [ ] 5. Telemetry in `src/platform/telemetry/`: the OpenTelemetry SDK with OTLP export of traces, metrics and logs, HTTP and database instrumentation, and a helper modules use for their own spans and token metrics. Commit.
- [ ] 6. Layering rules: lint rules (oxlint `no-restricted-imports` or a dependency check) that keep each module's internals private and its dependencies pointing inward (adapters → application → domain), and keep `apps/web` off `apps/service`. Write the module layout and these rules into `apps/service/README.md` as the module template. Commit.
- [ ] 7. Test support: a Vitest setup that runs repository tests against a throwaway Postgres database (migrated per run) and a helper to boot a Nest testing module. Commit.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next; anything surprising. -->

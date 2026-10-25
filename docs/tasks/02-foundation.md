# 02 · Foundation: workspace, service, database, events, telemetry

Status: in progress

## Goal

The skeleton every module grows in: the NestJS service on `localhost`, Postgres and `otel-lgtm` in Docker, Drizzle migrations, the domain-event bus with WebSocket push, OpenTelemetry, the contracts package, and one `npm run verify`. No business module yet: task 04 builds the first one on this template.

## Definition of Done

- [ ] `docker compose up -d` starts Postgres and `grafana/otel-lgtm` (both images pinned by tag). Check: `docker compose ps` shows both healthy.
- [ ] `npm run dev` starts the service on `localhost` only, runs pending migrations, and serves `GET /api/health` with the database state. Check: `curl http://localhost:<port>/api/health`; the port is refused from another machine on the LAN.
- [ ] A domain event emitted inside the service reaches a connected browser over WebSocket, typed by `packages/contracts`. Check: the integration test for the event bus and gateway.
- [ ] Traces, metrics and logs arrive in `otel-lgtm`. Check: the health request's trace is visible in Grafana's Tempo view.
- [ ] `npm run verify` runs typecheck, oxlint, Prettier check and Vitest across the workspace, and passes. Check: run it.
- [ ] `npm run verify:linux` runs the same checks in a `node:22` container against the working tree, and passes; the service starts there against the compose Postgres. Check: run it on the workstation.
- [ ] The platform layer `src/platform/os/` is the only code that branches on the operating system: the data directory default, path joining and length rules, the default shell. Check: a lint rule refuses `process.platform` outside it.
- [ ] The layering rules are enforced, not just written: a module importing another module's `domain/` or `adapters/`, or the web importing the service, fails `npm run verify`. Check: add such an import and see it fail.

## Read first

- [Spec §5](../spec.md#5-architecture-and-stack) and [Build defaults](README.md#build-defaults).
- [research/factory-reference.md](../../.scratch/the-office/research/factory-reference.md) §10 (settings layers; the merge mechanism is reusable, the schema is not) and §12 (costs to avoid: the god object and the snapshot grab-bag).

## Steps

- [x] 1. Workspace tooling: `.gitattributes` with `* text=auto eol=lf` (the checkout converts to CRLF otherwise, and Prettier expects LF), TypeScript strict in `tsconfig.base.json`, oxlint and Prettier configs, Vitest workspace config, and the root `verify` script. Confirm the chosen TypeScript version emits decorator metadata for Nest (`experimentalDecorators`, `emitDecoratorMetadata`), and that Vitest runs Nest code through SWC. Commit.
- [ ] 2. `docker-compose.yml` with Postgres and `grafana/otel-lgtm`, a `.env.example` with the database URL and `OFFICE_DATA_DIR`, and typed config loading in the service that refuses to start on a missing value. Commit.
- [ ] 3. `apps/service`: NestJS bound to `127.0.0.1`, `src/platform/` with config and the database (Drizzle, a migrations folder, migrate on start), and `GET /api/health`. Commit.
- [ ] 4. Domain events: a typed in-process event bus in `src/platform/events/`, a WebSocket gateway that forwards the events the web subscribes to, and their schemas in `packages/contracts`. Commit.
- [ ] 5. Telemetry in `src/platform/telemetry/`: the OpenTelemetry SDK with OTLP export of traces, metrics and logs, HTTP and database instrumentation, and a helper modules use for their own spans and token metrics. Commit.
- [ ] 6. Layering rules: lint rules (oxlint `no-restricted-imports` or a dependency check) that keep each module's internals private and its dependencies pointing inward (adapters → application → domain), and keep `apps/web` off `apps/service`. Write the module layout and these rules into `apps/service/README.md` as the module template. Commit.
- [ ] 7. The platform layer in `src/platform/os/` with Windows and Linux implementations of the data directory, paths and default shell, tests for both run on each platform, and `npm run verify:linux` (a `node:22` container with the repository mounted read-only and its own `node_modules`). Commit.
- [ ] 8. Test support: a Vitest setup that runs repository tests against a throwaway Postgres database (migrated per run) and a helper to boot a Nest testing module. Commit.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next; anything surprising. -->
- 2026-10-25 · step 1: task started by the user while task 01 step 8's check still runs. Root tooling, pinned: `.gitattributes` (`* text=auto eol=lf`, nothing renormalized; CRLF working-tree files stay as checked out), Prettier 3.9.10 (`printWidth` 100, code and config only: `*.md`, `design-system/` and `tools/engine-check/` in `.prettierignore`), oxlint 1.89.0 (`correctness` and `suspicious` as errors, `denyWarnings`; `design-system/` and `tools/engine-check/` ignored), Vitest 5.0.5 with vite 8.3.5 and root `test.projects: ["apps/*", "packages/*"]` (`tools/*` out: engine-check keeps its `node:test` suite on Node type stripping, run by `test:engine-check`), a root `tsconfig.json` typechecking the root config files, and `npm run verify` (typecheck in every workspace, oxlint, `prettier --check`, tests). Decorator flags go into `apps/service`'s tsconfig, and unplugin-swc into its own `vitest.config.ts`, in step 3, not the base: engine-check runs on type stripping with `erasableSyntaxOnly`, and the web must not go through SWC. Probe (scratchpad, Vitest 5.0.5 + unplugin-swc 2.0.0 + @swc/core 1.16.20 + Nest 12.2.0, flags inferred from tsconfig): `Reflect.getMetadata('design:paramtypes', Greeter)` is `[Clock]` and `Test.createTestingModule` resolves `Greeter` without `@Inject`; with `emitDecoratorMetadata` off both fail; `tsc` 7.0.2 passes. Next: step 2; Vitest joins `verify` with the first project (step 2 or 3) by prepending `vitest run && ` to the root `test` script. After task 01 step 8 is committed, one formatting-only commit runs Prettier over `tools/engine-check/`, fixes its 9 oxlint findings (`no-array-sort` ×5, `no-shadow` ×2, `consistent-function-scoping`, `no-unsafe-optional-chaining` in `transcripts.ts`) and drops both exclusions. Surprising: Vitest 5 throws "No projects were found" when `projects` matches nothing, `passWithNoTests` notwithstanding; Vite 8's built-in Oxc transform also emits legacy decorators and `design:paramtypes` from tsconfig, so tests would work without SWC (kept, as the Build defaults name it); Vitest 5's on-by-default `fsModuleCache` is not invalidated by tsconfig changes (stale transforms in the probe), to settle in step 3.

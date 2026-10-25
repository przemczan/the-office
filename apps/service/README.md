# @the-office/service

The Office's one Node service ([spec §5.1](../../docs/spec.md#51-shape)): NestJS on `127.0.0.1`, Postgres through Drizzle, the web app and its API on one origin, domain events pushed to the web over a WebSocket, telemetry to `otel-lgtm`. `npm run dev` at the root starts it against the compose stack with the web app compiled from its source by Vite; `npm run build` then `npm start` serves the built web app.

- `src/main.ts` (`npm start`) and `src/dev.ts` (`npm run dev`) call `launch.ts` with where the web app comes from; it starts telemetry and then loads `office.ts`, so the instrumentations patch what loads after, and imports nothing else.
- `src/office.ts` reads the config, starts the app and stops it on a signal.
- `src/app.module.ts` is the composition root: the platform and every module's Nest module.
- `src/platform/` is shared plumbing: config, database, domain events, HTTP, the WebSocket push, telemetry, `web-app/` (the pages on every path outside `/api`, behind the same localhost and Origin checks), and `os/`, the only code that branches on the operating system.
- `src/modules/<module>/` holds one module each, laid out as below.

## The module template

A module is a bounded context of [spec §5.3](../../docs/spec.md#53-modules), named as there: `work`, `people`, `pipelines`, `conversations`, `projects`, `engine`, `skills`, `notifications`. Telemetry, the spec's last one, is shared plumbing and lives in `src/platform/telemetry/`.

```
src/modules/work/
  index.ts           the public entry: what other modules and the composition root may use
  work.module.ts     the Nest module: providers, and the adapter bound to each port
  domain/            entities, rules, and domain events (subclasses of DomainEvent)
  ports/             what the application needs from outside, as interfaces
  application/       the use cases, as application services
  adapters/
    http/            controllers, mapping to and from @the-office/contracts
    postgres/        the module's tables (*.schema.ts) and the repositories implementing its ports
    websocket/       which of the module's events reach the web, and as what
```

`index.ts` exports the Nest module, the application services other modules call, and the domain events they subscribe to. Nothing else leaves the module: not its entities, ports, adapters or tables.

### The rules

`npm run verify` enforces these with the oxlint rules `office/module-boundaries` and `office/workspace-boundaries` from [tools/lint-rules](../../tools/lint-rules/src/plugin.ts).

- **Layers import only inward:** adapters → application → ports → domain. A layer imports its own files and the inner layers; the root files import any of them, and no layer imports the root files.
- **Another module is reached only through its `index.ts`**, from other modules and the composition root alike. Modules talk through application services and domain events, and none reads another's tables.
- **The platform is below the modules** and never imports one. The domain and ports layers take only `src/platform/events/domain-event.ts` from it; application and adapters use all of it.
- **Only adapters import `@the-office/contracts`.** The contracts are the wire format; the inner layers never see it.
- **A module holds only its four layers and its root files.** A layer importing from any other folder in the module is refused.
- **The top-level files of `src/` sit above everything.** Neither a module nor the platform imports them.
- **Tests (`*.test.ts`) may wire a module's layers together and boot the app.** The module boundary still holds for them.
- **No import cycles** (oxlint's `import/no-cycle`). Two modules that need each other would otherwise each import the other's `index.ts`, and one Nest module would be `undefined` in the other's `@Module({ imports })` at start. One module calls the other's application service, and the other reacts to the first's domain events instead.
- **Workspaces stay apart:** apps and tools are never imported, and a package under `packages/` is imported by its name, never by a relative path. This keeps `apps/web` off the service.

oxlint's JS plugins are alpha and not under semver. oxlint is pinned, and the plugin's tests run in `verify`, so an oxlint bump that breaks it fails there.

### What the platform gives a module

- **Domain events:** every state change emits one ([spec §5.3](../../docs/spec.md#53-modules)). Application services publish it on the global `EventBus`. A module that reacts to another's events subscribes to the event class it imports from that module's `index.ts`.
- **The WebSocket push:** the module's WebSocket adapter calls `WebEventForwarding.forward(EventClass, toWebEvent)` for each event the web sees. The event's schema goes into `packages/contracts`, in the union the web parses. Events nobody forwards stay inside the service.
- **The database:** Postgres adapters inject the Drizzle client with the `DATABASE` token; no other layer touches it. Tables live in `adapters/**/*.schema.ts`, the glob drizzle-kit reads. `npm run db:generate` writes the migration into `drizzle/`, and the service applies pending migrations at start.
- **Telemetry:** spans and token counts go through `Telemetry` (`inSpan`, `recordTokens`), never `@opentelemetry/*` directly. HTTP requests and database queries are traced without it. Logs go through Nest's `Logger`, which also exports them.
- **The operating system:** anything that differs between Windows and Linux comes from `src/platform/os/`: ask `currentOperatingSystem()` for it (the data directory default, path rules, the default shell), never which system it is. A lint rule refuses `process.platform`, `os.platform()` and `os.type()` anywhere else.

### Adding a module

1. Create `src/modules/<module>/` with the layers it needs, `<module>.module.ts`, and `index.ts` exporting that Nest module.
2. Import the Nest module from `index.ts` into `AppModule`. A module that calls another's application service imports that module's Nest module the same way.
3. Add its web events and HTTP shapes to `packages/contracts`.

## Tests

Tests sit beside their code as `*.test.ts`; the support they share is in `test/`.

- **Postgres is needed:** `docker compose up -d` first. Each run creates a throwaway database on the server `DATABASE_URL` names (from the environment, else `.env`), migrates it and drops it at the end. Every test file in the run shares it, so a repository test makes its own rows and looks only at those.
- **`startTestApplication({ ...metadata, database })`** boots Nest providers, controllers and modules with HTTP configured as in production, on `127.0.0.1` and a free port; `database: true` adds `DatabaseModule` on the test database. Close its `app` in `afterEach`.

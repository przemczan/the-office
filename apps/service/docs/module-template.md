# The module template

A module is a bounded context of [spec §5.3](../../../docs/spec/5.3-modules.md), named as there: `work`, `people`, `pipelines`, `conversations`, `projects`, `engine`, `skills`, `notifications`. Telemetry, the spec's last one, is shared plumbing and lives in `src/platform/telemetry/`.

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

## The rules

`npm run verify` enforces these with the oxlint rules `office/module-boundaries` and `office/workspace-boundaries` from [tools/lint-rules](../../../tools/lint-rules/src/plugin.ts).

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

## What the platform gives a module

- **Domain events:** every state change emits one ([spec §5.3](../../../docs/spec/5.3-modules.md)). Application services publish it on the global `EventBus`. A module that reacts to another's events subscribes to the event class it imports from that module's `index.ts`.
- **The WebSocket push:** the module's WebSocket adapter calls `WebEventForwarding.forward(EventClass, toWebEvent)` for each event the web sees. The event's schema goes into `packages/contracts`, in the union the web parses. Events nobody forwards stay inside the service.
- **The database:** Postgres adapters inject the Drizzle client with the `DATABASE` token; no other layer touches it. Tables live in `adapters/**/*.schema.ts`, the glob drizzle-kit reads. `npm run db:generate` writes the migration into `drizzle/`, and the service applies pending migrations at start.
- **Telemetry:** spans and token counts go through `Telemetry` (`inSpan`, `recordTokens`), never `@opentelemetry/*` directly. HTTP requests and database queries are traced without it. Logs go through Nest's `Logger`, which also exports them.
- **Uploads:** a module's `configure` applies `uploadBody(limit)` from `src/platform/http/` to its upload routes, and the controller reads the bytes with `uploadedBytes(body)`; the file comes as `application/octet-stream`, its name in the query.
- **Jobs of its own:** a module that runs a job by the clock imports `ScheduleModule` from `src/platform/schedule/` and asks `Schedule.daily(name, job)` in `onApplicationBootstrap`; never `setInterval`. Tests run the job with a `ManualSchedule` (`runDaily`).
- **The Office data directory:** inject `OfficeDataDirectory` and ask it for its `folder("worktrees")`, `"sessions"`, `"skills"` or `"attachments"`.
- **The operating system:** anything that differs between Windows and Linux comes from `src/platform/os/`: ask `currentOperatingSystem()` for it (the data directory default, path rules, the default shell), never which system it is. A lint rule refuses `process.platform`, `os.platform()` and `os.type()` anywhere else.

## A business module

Projects (`src/modules/projects/`) is the first; later modules copy its shape.

- **The domain is data and functions.** Entities are readonly records. A rule returns every problem it finds, in the UI's words, so a form can show them all at once. A change is a function from the record to `{ project, event }`, or `undefined` when nothing would change, so every change carries its event and no event announces nothing.
- **Refusals are domain errors carrying their reasons** (`ProjectRefused`, `ProjectNotFound`). The domain imports nothing from the platform but `DomainEvent`, so it can't share an error base class with other modules.
- **The HTTP adapter maps refusals** with a filter of its own (`ProjectRefusalsFilter`): 422 with `reasons` and the reasons joined into `message`, which is what `api-client.ts` shows, and 404 for a record that isn't there. Bodies and parameters are parsed with their contract schema by `ContractPipe` (`src/platform/http/`), which answers 400.
- **Application services save first and publish after,** never inside the transaction, so nothing hears of a change that wasn't kept.
- **Ports are abstract classes,** so each is its own injection token: `{ provide: Git, useClass: CommandLineGit }`.
- **A repository's `update(id, change)`** applies the change inside a transaction that holds the row (`SELECT … FOR UPDATE`), so two changes at once never lose one.
- **A rule that needs another module** goes through that module's application service, unless the other module will need this one: then this module declares a port of its own and the composition root binds it. Projects asks `KnownPipelines`, which `AppModule` binds to Pipelines' `PipelineLibrary`, because Pipelines' Stage interpreter will call Projects. The modules that read the library import `PipelineLibraryModule`, never `PipelinesModule`, which reacts to Work's `TaskStarted` and moves started Tasks through its `StartedTasks` port, bound to Work's `TaskService`.
- **A module called back by one that calls it** offers a registry the caller fills as it starts: Work, which opens Threads through Conversations, gives Conversations what a Thread on a Task works with through `TaskThreadSetups`, as modules give the Engine their Office tools through `OfficeToolRegistry`. A port bound by the composition root would make the two Nest modules import each other.
- **Fixtures** (`*.fixtures.ts`) are test data beside the code they describe, shared by its tests and left out of the build.

## Adding a module

1. Create `src/modules/<module>/` with the layers it needs, `<module>.module.ts`, and `index.ts` exporting that Nest module.
2. Import the Nest module from `index.ts` into `AppModule`. A module that calls another's application service imports that module's Nest module the same way.
3. Add its web events and HTTP shapes to `packages/contracts`.

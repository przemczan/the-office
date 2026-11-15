# @the-office/service

The Office's one Node service ([spec §5.1](../../docs/spec/5.1-shape.md)): NestJS on `127.0.0.1`, Postgres through Drizzle, the web app and its API on one origin, domain events pushed to the web over a WebSocket, telemetry over OTLP, to the bundled Grafana (which the service runs itself in Docker, as Compose project `the-office-grafana`, when Settings › Telemetry chooses it) or your own endpoint. `npm run dev` at the root starts it against the compose stack with the web app compiled from its source by Vite; `npm run build` then `npm start` serves the built web app. A live check that reads Grafana needs Bundled Grafana chosen in the dev Office, or `OFFICE_CHECK_GRAFANA=off` ([docs/testing.md](docs/testing.md#the-test-project)).

- `src/main.ts` (`npm start`, under the launcher in `tools/office-launcher/`, which updates The Office when the service exits for it: [docs/running-the-office.md](../../docs/running-the-office.md)) and `src/dev.ts` (`npm run dev`) call `launch.ts` with where the web app comes from; it starts telemetry and then loads `office.ts`, so the instrumentations patch what loads after, and imports nothing else.
- `src/office.ts` reads the config, starts the app and stops it on a signal.
- `src/app.module.ts` is the composition root: the platform and every module's Nest module.
- `src/platform/` is shared plumbing: config, database, domain events, HTTP, `office-data/` (the Office data directory), the WebSocket push, telemetry, `web-app/` (the pages on every path outside `/api`, behind the same localhost and Origin checks), and `os/`, the only code that branches on the operating system.
- `src/modules/<module>/` holds one module each, laid out as below.

Read when the step needs it:

- [docs/module-template.md](docs/module-template.md): how a module is laid out, the boundary rules lint enforces, what the platform gives a module, and how a business module is written. Read it when adding a module, adding a kind of file a module doesn't have yet, or when a boundary lint error is unclear.
- [docs/testing.md](docs/testing.md): the test database, port contracts, the scripted engine, and which tests must stay alone. Read it before writing a kind of test the module doesn't have yet, or running a live check.
- Each module's `MAP.md` (`src/modules/<module>/MAP.md`) and the platform's (`src/platform/MAP.md`): what it owns, what it talks to, its traps, then its routes, events, tables and files, generated from the code.

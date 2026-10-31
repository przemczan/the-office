# Progress log: 34 · Telemetry: the bundled `otel-lgtm` optional, the user's own Grafana or collector

Moved from [34-telemetry-own-grafana.md](../34-telemetry-own-grafana.md) when the task was done. One line per commit, newest last.

- 2026-10-31 · step 0: task file written, linked from the README; next is step 1, the compose profile.
- 2026-10-31 · step 1: `otel-lgtm` behind the `grafana` compose profile, on in `.env.example`; verify-linux runs without it; `.env.example` explains the choices; next is step 2, the export timeout and the live check.
- 2026-10-31 · step 2: the export timeout from `OTEL_EXPORTER_OTLP_TIMEOUT`, 2 seconds otherwise; a trace seen in a stand-in Grafana with the bundled one off; task done. Next is task 35.

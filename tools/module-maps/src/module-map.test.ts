import assert from "node:assert/strict";
import { test } from "node:test";
import { GENERATED_MARKER, generatedPart, mapText } from "./module-map.ts";

const files = [
  {
    path: "domain/gate.ts",
    text: "export class GateReached extends DomainEvent {}\nexport function afterGate() {}",
  },
  { path: "domain/gate.test.ts", text: "" },
  { path: "index.ts", text: "export { GateService } from './application/gate-service';" },
  {
    path: "adapters/postgres/runs.schema.ts",
    text: 'export const runs = pgTable("stage_runs", {});',
  },
  { path: "application/gate-service.ts", text: "export class GateService {}" },
];

test("the generated part lists the entry, events, tables, then each folder with the module's root first", () => {
  assert.equal(
    generatedPart(files),
    [
      "## Public entry (`index.ts`)",
      "",
      "GateService",
      "",
      "## Domain events",
      "",
      "- `domain/gate.ts`: GateReached",
      "",
      "## Tables",
      "",
      "- `adapters/postgres/runs.schema.ts`: stage_runs",
      "",
      "## Files",
      "",
      "### adapters/postgres/",
      "",
      "- `runs.schema.ts`: runs",
      "",
      "### application/",
      "",
      "- `gate-service.ts`: GateService",
      "",
      "### domain/",
      "",
      "- `gate.ts`: GateReached, afterGate",
      "- Tests: gate.test.ts",
      "",
    ].join("\n"),
  );
});

test("the handwritten part is kept and the generated part replaced", () => {
  const existing = `# Pipelines\n\nTraps written by hand.\n\n${GENERATED_MARKER}\n\nstale`;
  const text = mapText("Pipelines", existing, files);

  assert.ok(
    text.startsWith(
      `# Pipelines\n\nTraps written by hand.\n\n${GENERATED_MARKER}\n\n## Public entry`,
    ),
  );
  assert.ok(!text.includes("stale"));
});

test("a new map starts with its title and a note of what to write by hand", () => {
  assert.match(
    mapText("Work: module map", undefined, files),
    /^# Work: module map\n\nWhat this part owns/,
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GENERATED_MARKER,
  HANDWRITTEN_CHARACTER_CAP,
  HANDWRITTEN_LINE_CAP,
  generatedPart,
  handwrittenProblems,
  mapText,
} from "./module-map.ts";

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

test("a handwritten part within its caps has no problems, whatever the generated part holds", () => {
  const generated = "x".repeat(HANDWRITTEN_CHARACTER_CAP * 2);
  assert.deepEqual(
    handwrittenProblems(`# Work\n\n## Traps\n\n- One trap.\n\n${GENERATED_MARKER}\n\n${generated}`),
    [],
  );
});

test("a handwritten part over the character cap is refused with its size", () => {
  const handwritten = Array.from({ length: 40 }, () => `- ${"a".repeat(300)}`).join("\n");
  assert.deepEqual(handwrittenProblems(`${handwritten}\n\n${GENERATED_MARKER}\n`), [
    `its handwritten part is ${handwritten.length} characters, over ${HANDWRITTEN_CHARACTER_CAP}`,
  ]);
});

test("each handwritten line over the line cap is refused by its number", () => {
  const long = `- ${"b".repeat(HANDWRITTEN_LINE_CAP)}`;
  assert.deepEqual(
    handwrittenProblems(`# Work\n\n${long}\n- short\n${long}\n\n${GENERATED_MARKER}\n`),
    [
      `line 3 is ${long.length} characters, over ${HANDWRITTEN_LINE_CAP}`,
      `line 5 is ${long.length} characters, over ${HANDWRITTEN_LINE_CAP}`,
    ],
  );
});

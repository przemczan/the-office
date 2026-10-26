import assert from "node:assert/strict";
import { test } from "node:test";
import { outlineOf } from "./source-outline.ts";

test("lists declared, listed and star exports once each, aliases by their exported name", () => {
  const source = [
    "export abstract class Git {}",
    "export async function changes() {}",
    "export const LIMIT = 3;",
    "export type Stage = { key: string };",
    "export interface Walk {}",
    "export { TaskService, type TaskRefused, Internal as Public } from './task';",
    "export {",
    "  StageRun,",
    "  Git,",
    "} from './run';",
    "export * from './events';",
    "export * as schemas from './schemas';",
    "const notExported = 1;",
  ].join("\n");

  assert.deepEqual(outlineOf(source).exports, [
    "Git",
    "changes",
    "LIMIT",
    "Stage",
    "Walk",
    "TaskService",
    "TaskRefused",
    "Public",
    "StageRun",
    "all of ./events",
    "schemas (all of ./schemas)",
  ]);
});

test("finds domain events and tables", () => {
  const source = [
    "export class GateReached extends DomainEvent {}",
    "export class NotAnEvent extends Error {}",
    'export const stageRuns = pgTable(\n  "stage_runs",',
  ].join("\n");

  const outline = outlineOf(source);
  assert.deepEqual(outline.events, ["GateReached"]);
  assert.deepEqual(outline.tables, ["stage_runs"]);
});

test("joins each route to its controller's path and names its handler", () => {
  const source = [
    '@Controller("tasks/:id/gate")',
    "export class TaskGateController {",
    '  @Post("continue")',
    "  @HttpCode(204)",
    "  async continue(@Param('id') id: string) {}",
    "",
    "  @Get()",
    "  show() {}",
    "}",
    "@Controller()",
    "export class HealthController {",
    '  @Get("/health/")',
    "  health() {}",
    "}",
  ].join("\n");

  assert.deepEqual(outlineOf(source).routes, [
    { method: "POST", path: "/tasks/:id/gate/continue", handler: "TaskGateController.continue" },
    { method: "GET", path: "/tasks/:id/gate", handler: "TaskGateController.show" },
    { method: "GET", path: "/health", handler: "HealthController.health" },
  ]);
});

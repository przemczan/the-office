import { describe, expect, it } from "vitest";
import { statementShapeOf } from "./statement-shape.js";

describe("statementShapeOf", () => {
  it("makes Drizzle's parameters `?` and names its quoted table, unquoted", () => {
    expect(
      statementShapeOf(
        'select "id", "title" from "stage_runs" where ("stage_runs"."task_id" = $1 and "stage_runs"."number" > $2) limit $3',
      ),
    ).toEqual({
      shape:
        'select "id", "title" from "stage_runs" where ("stage_runs"."task_id" = ? and "stage_runs"."number" > ?) limit ?',
      operation: "SELECT",
      table: "stage_runs",
    });
  });

  it("makes an insert's VALUES rows one `?`", () => {
    expect(
      statementShapeOf(
        'insert into "tasks" ("id", "title", "created_at") values ($1, $2, default), ($3, $4, default) returning "id"',
      ),
    ).toEqual({
      shape: 'insert into "tasks" ("id", "title", "created_at") values (?) returning "id"',
      operation: "INSERT",
      table: "tasks",
    });
  });

  it("makes string and number literals `?`, collapses whitespace and an IN list", () => {
    expect(
      statementShapeOf(`UPDATE tasks
        SET title = 'It''s done',   priority = 3.5
        WHERE id IN (1, 2, 3)`),
    ).toEqual({
      shape: "UPDATE tasks SET title = ?, priority = ? WHERE id IN (?)",
      operation: "UPDATE",
      table: "tasks",
    });
  });

  it("names a delete's table", () => {
    expect(statementShapeOf('delete from "work"."decisions" where "id" = $1')).toEqual({
      shape: 'delete from "work"."decisions" where "id" = ?',
      operation: "DELETE",
      table: "decisions",
    });
  });
});

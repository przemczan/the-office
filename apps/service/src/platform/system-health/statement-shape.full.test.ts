import { describe, expect, it } from "vitest";
import { STATEMENT_SHAPE_LENGTH, statementShapeOf } from "./statement-shape.js";

const shapeOf = (statement: string): string => statementShapeOf(statement).shape;

describe("statementShapeOf, edge cases", () => {
  it.each([
    ["select * from table1 where col2 = 5", "select * from table1 where col2 = ?"],
    ['select "col2", t1.x3 from "table1" t1', 'select "col2", t1.x3 from "table1" t1'],
    ["select $1::int, $12", "select ?::int, ?"],
    ["select 1e10, .5, 2.5e-3, 1_000", "select ?, ?, ?, ?"],
    ["select -1", "select -?"],
    ["select E'it\\'s', 'a''b'", "select ?, ?"],
    ["select B'101', X'1F', N'text'", "select ?, ?, ?"],
    ["select $$it's $1$$, $tag$x$tag$", "select ?, ?"],
    ["select 'a' -- 'b' 42\n from t", "select ? from t"],
    ["select /* 'x' 1 */ 2", "select ?"],
    ['select "say ""hi"" 1" from t', 'select "say ""hi"" 1" from t'],
    ["  select\t\n1  ", "select ?"],
  ])("%s", (statement, shape) => {
    expect(shapeOf(statement)).toBe(shape);
  });

  it("makes an IN list one `?` whatever its spacing, but keeps a subquery", () => {
    expect(shapeOf("select * from t where id in($1,$2 , $3) and x not in ('a')")).toBe(
      "select * from t where id in(?) and x not in (?)",
    );
    expect(shapeOf("select * from t where id in (select id from u where n = 1)")).toBe(
      "select * from t where id in (select id from u where n = ?)",
    );
  });

  it("makes VALUES rows one `?` with calls and nested parentheses inside", () => {
    expect(shapeOf("insert into t (a, b) values (now(), coalesce($1, 'x')),(1, (2))")).toBe(
      "insert into t (a, b) values (?)",
    );
    expect(shapeOf("insert into t (a) values ($1) on conflict (a) do nothing")).toBe(
      "insert into t (a) values (?) on conflict (a) do nothing",
    );
  });

  it("cuts the shape at 200 characters, a long VALUES list still one `?`", () => {
    const columns = Array.from({ length: 60 }, (_, index) => `"column_${index}"`).join(", ");
    const rows = Array.from(
      { length: 3_000 },
      (_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`,
    );
    const statement = `insert into "t" (${columns}) values ${rows.join(", ")}`;

    const { shape } = statementShapeOf(statement);

    expect(shape).toHaveLength(STATEMENT_SHAPE_LENGTH);
    expect(shapeOf(`insert into t (a, b) values ${rows.join(", ")}`)).toBe(
      "insert into t (a, b) values (?)",
    );
  });

  it.each([
    ["with recent as (select * from runs) select * from recent", "SELECT", "recent"],
    [
      'with "moved" as (delete from "a" returning *) insert into "b" select * from "moved"',
      "INSERT",
      "b",
    ],
    ["with recursive x as (select 1) update y set z = 1", "UPDATE", "y"],
    ["update only public.tasks set a = 1", "UPDATE", "tasks"],
    ["select now()", "SELECT", ""],
    ["select extract(epoch from now())", "SELECT", ""],
    ["select * from (select 1) as sub", "SELECT", ""],
    ["select count(*) from tasks join projects on true", "SELECT", "tasks"],
    ["begin", "BEGIN", ""],
    ["COMMIT", "COMMIT", ""],
    ['insert into "drizzle"."__drizzle_migrations" values (1)', "INSERT", "__drizzle_migrations"],
    ["", "", ""],
  ])("%s is %s on %j", (statement, operation, table) => {
    expect(statementShapeOf(statement)).toMatchObject({ operation, table });
  });
});

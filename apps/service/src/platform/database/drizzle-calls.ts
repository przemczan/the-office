import type { Logger } from "@nestjs/common";
// Namespaces, so a class an upgrade dropped reads as undefined rather than failing the import.
import * as pgCore from "drizzle-orm/pg-core";
import * as relationalQuery from "drizzle-orm/pg-core/query-builders/query";
import * as queryPromise from "drizzle-orm/query-promise";

/**
 * Where a Drizzle query was built, so System health can name the code that ran it.
 *
 * `await db.select()…` awaits Drizzle's own thenable, whose `then` V8 calls from a job with no
 * async stack frames: by the time the pool runs the query, its caller is off the stack. So the
 * call is captured where the caller still is, at the method that makes a runnable query
 * (`from`, `values`, `set`, `delete`, `execute`, `findMany`, …), kept on that query, and held in
 * `currentCall` while its `then` runs: Drizzle sends the query to the pool synchronously from
 * there, where `drizzleCall()` reads it. A slot held only for that synchronous run, rather than
 * an AsyncLocalStorage, never leaks into the work that follows the query.
 *
 * Trap: this patches Drizzle's prototypes, so it is pinned to drizzle-orm's exact version, and
 * `drizzle-calls.test.ts` fails when an upgrade changes them. Should they be missing at runtime it
 * installs nothing and logs one warning; queries run as before, their call sites "not found".
 */

/** Frames kept of a query's call: the caller is a frame or two under the wrapper. */
const CALL_FRAMES = 30;

const BUILT_AT = Symbol("builtAt");

type Method = (this: object, ...args: unknown[]) => unknown;

/** The prototype of the class `namespace` exports as `name`, if it still does. */
function prototypeOf(namespace: object, name: string): object | undefined {
  const exported: unknown = (namespace as Record<string, unknown>)[name];
  return typeof exported === "function" ? (exported.prototype as object) : undefined;
}

/**
 * The methods that answer a runnable query, by the prototype holding them. PgTransaction extends
 * PgDatabase, so a transaction's queries are kept too; `db.with(…)`'s `delete` and `$count` are
 * not, and The Office uses neither.
 */
const QUERY_MAKERS: readonly (readonly [string, object | undefined, readonly string[]])[] = [
  ["PgSelectBuilder", prototypeOf(pgCore, "PgSelectBuilder"), ["from"]],
  ["PgInsertBuilder", prototypeOf(pgCore, "PgInsertBuilder"), ["values", "select"]],
  ["PgUpdateBuilder", prototypeOf(pgCore, "PgUpdateBuilder"), ["set"]],
  [
    "PgDatabase",
    prototypeOf(pgCore, "PgDatabase"),
    ["delete", "execute", "refreshMaterializedView"],
  ],
  [
    "RelationalQueryBuilder",
    prototypeOf(relationalQuery, "RelationalQueryBuilder"),
    ["findMany", "findFirst"],
  ],
];

/** The prototypes whose `then` runs a query: PgSelectBase copies QueryPromise's, as a mixin. */
const QUERY_RUNNERS: readonly (readonly [string, object | undefined])[] = [
  ["QueryPromise", prototypeOf(queryPromise, "QueryPromise")],
  ["PgSelectBase", prototypeOf(pgCore, "PgSelectBase")],
];

interface Patch {
  readonly className: string;
  readonly prototype: object | undefined;
  readonly name: string;
  readonly around: (original: Method) => Method;
}

const PATCHES: readonly Patch[] = [
  ...QUERY_MAKERS.flatMap(([className, prototype, names]) =>
    names.map((name) => ({ className, prototype, name, around: keepCall })),
  ),
  ...QUERY_RUNNERS.map(([className, prototype]) => ({
    className,
    prototype,
    name: "then",
    around: runWithCall,
  })),
];

let installed = false;
let currentCall: Error | undefined;

/** The call that built the Drizzle query being sent now, if one is. */
export function drizzleCall(): Error | undefined {
  return currentCall;
}

/** Captures a call as it is made: its frames collected now, formatted only when `stack` is read. */
export function captureCall(): Error {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = CALL_FRAMES;
  const call = new Error("query called");
  Error.stackTraceLimit = limit;
  return call;
}

/** Patches Drizzle once, so each query carries where it was built; nothing when it can't. */
export function captureDrizzleCalls(logger: Logger): void {
  if (installed) return;
  installed = true;
  const missing = missingDrizzleMethods();
  if (missing.length > 0) {
    logger.warn(
      `Drizzle's query builders changed (${missing.join(", ")} not found), so System health's slowest queries won't say where in the code they were run from.`,
    );
    return;
  }
  for (const { prototype, name, around } of PATCHES) {
    const original = methodOf(prototype, name);
    if (prototype !== undefined && original !== undefined) {
      (prototype as Record<string, Method>)[name] = around(original);
    }
  }
}

/** The patched methods this version of Drizzle lacks, as `Class.method`; none when all are there. */
export function missingDrizzleMethods(): string[] {
  return PATCHES.filter(({ prototype, name }) => methodOf(prototype, name) === undefined).map(
    ({ className, name }) => `${className}.${name}`,
  );
}

function methodOf(prototype: object | undefined, name: string): Method | undefined {
  const method: unknown = prototype === undefined ? undefined : Reflect.get(prototype, name);
  return typeof method === "function" ? (method as Method) : undefined;
}

function keepCall(original: Method): Method {
  return function (this: object, ...args: unknown[]) {
    const call = captureCall();
    const query = original.apply(this, args);
    if (typeof query === "object" && query !== null && !(BUILT_AT in query)) {
      Object.defineProperty(query, BUILT_AT, { value: call });
    }
    return query;
  };
}

function runWithCall(original: Method): Method {
  return function (this: object, ...args: unknown[]) {
    const call = (this as { [BUILT_AT]?: Error })[BUILT_AT];
    if (call === undefined) return original.apply(this, args);
    const outer = currentCall;
    currentCall = call;
    try {
      return original.apply(this, args);
    } finally {
      currentCall = outer;
    }
  };
}

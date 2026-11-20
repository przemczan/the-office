import { Logger } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";

export const DATABASE_POOL = Symbol("DatabasePool");

/** The optional observer of every query the pool runs, bound with this token (System health's recorder). */
export const DATABASE_QUERY_OBSERVER = Symbol("DatabaseQueryObserver");

/** Told each query the pool ran once it ends, failed or not. */
export interface DatabaseQueryObserver {
  /** `waitingCount` is how many queries waited for one of the pool's connections as it started. */
  recordQuery(text: string, durationMs: number, waitingCount: number): void;
}

// Bounds every wait for a connection, so a health check reports a stopped database instead of hanging.
const CONNECTION_TIMEOUT_MILLISECONDS = 5_000;

export function createDatabasePool(url: string, observer?: DatabaseQueryObserver): Pool {
  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MILLISECONDS,
  });
  // An idle client dropped by a Postgres restart emits "error" on the pool; unhandled, it ends the process.
  const logger = new Logger("Database");
  pool.on("error", (error) => logger.warn(`An idle database connection failed: ${error.message}`));
  if (observer) observeQueries(pool, observer, logger);
  return pool;
}

type Query = (...args: unknown[]) => unknown;

/**
 * Wraps the pool's `connect` so every client it hands out has its `query` timed, once per client.
 * `pool.query` takes a client through `connect` too, so this one place times both its queries and
 * those on a client a transaction holds, each once. A query's time starts when it is sent on its
 * client, so a wait for a connection is told by the waiting count, not in the duration. An
 * observer that throws is logged, never let through: it runs before the query's callback and in
 * its promise's `finally`, where it would leave the pool's client unreleased or fail the query.
 */
function observeQueries(pool: Pool, observer: DatabaseQueryObserver, logger: Logger): void {
  const observed = new WeakSet<PoolClient>();
  const connect = pool.connect.bind(pool) as (
    callback?: (error: Error | undefined, client: PoolClient | undefined, done: unknown) => void,
  ) => Promise<PoolClient> | undefined;
  const observe = (client: PoolClient | undefined): void => {
    if (!client || observed.has(client)) return;
    observed.add(client);
    const query = client.query.bind(client) as Query;
    (client as { query: Query }).query = (...args: unknown[]) => {
      const waitingCount = pool.waitingCount;
      return timed(query, args, (durationMs) => {
        try {
          observer.recordQuery(textOf(args[0]), durationMs, waitingCount);
        } catch (error) {
          logger.warn(`A query's duration wasn't recorded: ${String(error)}`);
        }
      });
    };
  };
  (pool as { connect: unknown }).connect = (
    callback?: (error: Error | undefined, client: PoolClient | undefined, done: unknown) => void,
  ) => {
    if (typeof callback === "function") {
      return connect((error, client, done) => {
        observe(client);
        callback(error, client, done);
      });
    }
    return connect()?.then((client) => {
      observe(client);
      return client;
    });
  };
}

/** The statement a query was given: its text, or a query config's `text`. */
function textOf(statement: unknown): string {
  if (typeof statement === "string") return statement;
  if (typeof statement === "object" && statement !== null && "text" in statement) {
    const { text } = statement;
    if (typeof text === "string") return text;
  }
  return "";
}

/**
 * Runs `query` with `args`, telling `ended` its duration however it answers: by a callback
 * argument, by a query config's `callback`, by a submittable's `end` or `error` event, or by the
 * promise it returns. Its answer and failure reach the caller unchanged.
 */
function timed(query: Query, args: unknown[], ended: (durationMs: number) => void): unknown {
  const startedAt = performance.now();
  let told = false;
  const tell = (): void => {
    if (told) return;
    told = true;
    ended(performance.now() - startedAt);
  };
  const callbackAt = args.findLastIndex((arg) => typeof arg === "function");
  const callback = args[callbackAt];
  if (typeof callback === "function") {
    const withTiming = [...args];
    withTiming[callbackAt] = (...answer: unknown[]) => {
      tell();
      return (callback as Query)(...answer);
    };
    return query(...withTiming);
  }
  const [statement, ...rest] = args;
  if (typeof statement === "object" && statement !== null) {
    if ("submit" in statement && typeof statement.submit === "function") {
      if ("once" in statement && typeof statement.once === "function") {
        statement.once("end", tell);
        statement.once("error", tell);
      }
      return query(...args);
    }
    if ("callback" in statement && typeof statement.callback === "function") {
      const configCallback = statement.callback as Query;
      return query(
        {
          ...statement,
          callback: (...answer: unknown[]) => {
            tell();
            return configCallback(...answer);
          },
        },
        ...rest,
      );
    }
  }
  const answer = query(...args);
  if (answer instanceof Promise) return answer.finally(tell);
  tell();
  return answer;
}

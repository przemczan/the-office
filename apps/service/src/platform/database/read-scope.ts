import { AsyncLocalStorage } from "node:async_hooks";

/**
 * One unit of work's reads, kept so the same read asked again within it (a request reading the
 * same Role card for each of its Threads) reaches the database once. The promise is kept, not
 * the result, so reads asked at the same time share one query.
 */
class ReadScope {
  private readonly reads = new Map<string, Promise<unknown>>();
  private ended = false;

  read<Result>(key: string, read: () => Promise<Result>): Promise<Result> {
    if (this.ended) return read();
    const kept = this.reads.get(key);
    if (kept) return kept as Promise<Result>;
    const reading = read();
    this.reads.set(key, reading);
    // A failed read isn't answered again from the scope: the next ask tries the database anew.
    reading.catch(() => {
      if (this.reads.get(key) === reading) this.reads.delete(key);
    });
    return reading;
  }

  forget(): void {
    this.reads.clear();
  }

  end(): void {
    this.ended = true;
    this.reads.clear();
  }
}

const currentScope = new AsyncLocalStorage<ReadScope>();

/**
 * Runs `work` in a scope of its own, which ends when `work`'s promise settles: anything `work`
 * started in the background and that runs later reads the database again.
 */
export async function inReadScope<Result>(work: () => Promise<Result>): Promise<Result> {
  const scope = new ReadScope();
  try {
    return await currentScope.run(scope, work);
  } finally {
    scope.end();
  }
}

/**
 * Starts `work` in a scope of its own for a caller whose unit of work doesn't end with a promise
 * (an HTTP request, ended by its response), and answers how to end that scope.
 */
export function startInReadScope(work: () => void): () => void {
  const scope = new ReadScope();
  currentScope.run(scope, work);
  return () => scope.end();
}

/**
 * Answers `read` once per scope for `key`, the read's name and its arguments
 * (`readKey("PostgresRoleRepository.find", key)`); outside a scope it reads every time.
 */
export function readOnce<Result>(key: string, read: () => Promise<Result>): Promise<Result> {
  const scope = currentScope.getStore();
  return scope ? scope.read(key, read) : read();
}

/** The key of a read for `readOnce`: its name, then its arguments as JSON. */
export function readKey(name: string, ...readArguments: readonly unknown[]): string {
  return readArguments.length === 0 ? name : `${name}:${JSON.stringify(readArguments)}`;
}

/**
 * Runs `write`, then drops every read the current scope kept, so what follows reads the database
 * again. Each write of a repository whose reads go through `readOnce` runs through it. Dropped
 * after the write, failed or not, so no read asked while it ran is kept past it.
 */
export async function forgettingReads<Result>(write: () => Promise<Result>): Promise<Result> {
  try {
    return await write();
  } finally {
    currentScope.getStore()?.forget();
  }
}

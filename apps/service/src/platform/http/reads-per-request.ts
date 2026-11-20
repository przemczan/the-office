import type { RequestHandler } from "express";
import { startInReadScope } from "../database/read-scope.js";

/** The methods that only read; only their requests share their reads (`readOnce`). */
const READING_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/**
 * Gives each GET and HEAD request a read scope, so a read it asks many times (a Role card for
 * each of a Task's Threads) reaches the database once. The scope ends with the response, so
 * work the request left running reads the database again afterwards.
 */
export function readOncePerRequest(): RequestHandler {
  return (request, response, next) => {
    if (!READING_METHODS.has(request.method)) {
      next();
      return;
    }
    const endScope = startInReadScope(next);
    if (response.closed) endScope();
    else response.once("close", endScope);
  };
}

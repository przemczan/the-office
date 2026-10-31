/**
 * Why a `fetch` given `AbortSignal.timeout(timeoutMs)` failed, in words: Node's own message is
 * only "fetch failed", the reason being in its cause.
 */
export function fetchFailure(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return `it didn't answer within ${timeoutMs / 1000} s`;
  }
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause instanceof Error) return cause.message;
  return error instanceof Error ? error.message : String(error);
}

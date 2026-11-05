import type { ThreadContext } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { useClock } from "../use-clock.ts";
import { cacheStateAt, type CacheState } from "./context-words.ts";

/** The Thread's cache as the clock moves; the mark and the words beside the composer share it. */
export function useCacheState(
  context: Pick<ThreadContext, "reason" | "cacheWarmUntil">,
): CacheState {
  return cacheStateAt(context, useClock());
}

/** Warm, with the minutes left of the cache's hour, or cold; nothing before there is a session. */
export function CacheMark({ context }: { readonly context: ThreadContext }): ReactNode {
  const cache = useCacheState(context);
  if (cache.kind === "none") return null;
  if (cache.kind === "cold") {
    const words = "Cache cold: the next message reads the context again, or starts fresh";
    return (
      <span className="cache-mark cold" role="img" aria-label={words} title={words}>
        <Icon name="snowflake" size={12} />
      </span>
    );
  }
  const words = `Cache warm: ${cache.minutesLeft} min left, so the next message continues cheaply`;
  return (
    <span className="cache-mark warm" role="img" aria-label={words} title={words}>
      <Icon name="flame" size={12} />
      {cache.minutesLeft}m
    </span>
  );
}

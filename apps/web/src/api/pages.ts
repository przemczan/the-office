import { infiniteQueryOptions, type InfiniteData, type QueryKey } from "@tanstack/react-query";
import type { z } from "zod";
import { getFromApi } from "./api-client.ts";

/** A page as the contracts' `pageSchemaOf` gives it. */
interface Paged<Row> {
  readonly rows: readonly Row[];
  readonly next: string | null;
  readonly total: number;
}

/**
 * A list the service answers a page at a time, newest first (contracts' `paging.ts`): each page
 * read with the cursor the one before gave, as `?after=`, until one gives none. `path` may carry a
 * query of its own.
 */
export function pagedQueryOptions<Schema extends z.ZodType<Paged<unknown>>>(
  queryKey: QueryKey,
  path: `/${string}`,
  schema: Schema,
) {
  return infiniteQueryOptions({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => getFromApi(pagePath(path, pageParam), schema, signal),
    getNextPageParam: (page: z.infer<Schema>) => page.next ?? undefined,
  });
}

/** The rows of every page read so far, in their order. */
export function rowsOf<Row>(data: InfiniteData<Paged<Row>> | undefined): readonly Row[] {
  return data?.pages.flatMap(({ rows }) => rows) ?? [];
}

/** The whole list's count, as the newest page read says it. */
export function totalOf(data: InfiniteData<Paged<unknown>> | undefined): number {
  return data?.pages.at(-1)?.total ?? 0;
}

/** Each page read so far with `change` applied to its rows; nothing read stays as it is. */
export function changeRows<Page extends { readonly rows: unknown[] }>(
  data: InfiniteData<Page> | undefined,
  change: (rows: Page["rows"]) => Page["rows"],
): InfiniteData<Page> | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((page) => ({ ...page, rows: change(page.rows) })) };
}

function pagePath(path: `/${string}`, after: string | undefined): `/${string}` {
  if (after === undefined) return path;
  return `${path}${path.includes("?") ? "&" : "?"}after=${encodeURIComponent(after)}`;
}

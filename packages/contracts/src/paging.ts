import { z } from "zod";

/** How many rows a list that grows without end answers at a time. */
export const PAGE_SIZE = 30;

/**
 * `?after=`: the cursor a page answered as `next`, for the page after it; none for the first.
 * Opaque to the web: the service makes it from the last row's sort key.
 */
export const pageQuerySchema = z.object({ after: z.string().min(1).optional() });
export type PageQuery = z.infer<typeof pageQuerySchema>;

/**
 * A page of a list read newest first, `PAGE_SIZE` rows at most: `next` reads on from its last row,
 * null on the last page; `total` counts the whole list, for its heading.
 */
export function pageSchemaOf<Row extends z.ZodType>(row: Row) {
  return z.object({
    rows: z.array(row),
    next: z.string().nullable(),
    total: z.number().int().nonnegative(),
  });
}

import { BadRequestException } from "@nestjs/common";
import { PAGE_SIZE } from "@the-office/contracts";
import { z } from "zod";
import type { Page, PageCursor, PageRequest } from "../paging/page.js";

const cursorSchema = z.object({ at: z.iso.datetime(), id: z.string().min(1) });

/** A page's `next` as the web gets it: opaque, as the web only sends it back as `?after=`. */
function cursorText(cursor: PageCursor | undefined): string | null {
  if (cursor === undefined) return null;
  const text = JSON.stringify({ at: cursor.at.toISOString(), id: cursor.id });
  return Buffer.from(text).toString("base64url");
}

/** A page as the contracts' `pageSchemaOf` answers it, each row as `toRow` answers it. */
export function toPageResponse<Row, RowResponse>(
  { rows, next, total }: Page<Row>,
  toRow: (row: Row) => RowResponse,
): { readonly rows: RowResponse[]; readonly next: string | null; readonly total: number } {
  return { rows: rows.map(toRow), next: cursorText(next), total };
}

/** The page a request's `?after=` asks for, `PAGE_SIZE` rows; 400 for a cursor no page gave. */
export function pageRequested(after: string | undefined): PageRequest {
  return { after: after === undefined ? undefined : cursorFrom(after), size: PAGE_SIZE };
}

function cursorFrom(text: string): PageCursor {
  try {
    const { at, id } = cursorSchema.parse(JSON.parse(Buffer.from(text, "base64url").toString()));
    return { at: new Date(at), id };
  } catch {
    throw new BadRequestException("That isn't a page's cursor.");
  }
}

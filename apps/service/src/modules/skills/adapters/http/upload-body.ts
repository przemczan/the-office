import { PayloadTooLargeException } from "@nestjs/common";
import { SKILL_UPLOAD_BYTES } from "@the-office/contracts";
import express, { type NextFunction, type Request, type Response } from "express";

const readRaw = express.raw({ type: "application/octet-stream", limit: SKILL_UPLOAD_BYTES });

/**
 * Reads an upload's body as its bytes, which Nest's own parsers leave alone, and answers one too
 * large for the library in its words.
 */
export function uploadBody(request: Request, response: Response, next: NextFunction): void {
  readRaw(request, response, (error?: unknown) => {
    if ((error as { type?: string } | undefined)?.type === "entity.too.large") {
      next(
        new PayloadTooLargeException(
          `An upload may be at most ${SKILL_UPLOAD_BYTES / 1024 / 1024} MB.`,
        ),
      );
      return;
    }
    next(error);
  });
}

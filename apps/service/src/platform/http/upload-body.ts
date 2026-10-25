import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import express, { type NextFunction, type Request, type Response } from "express";

type Middleware = (request: Request, response: Response, next: NextFunction) => void;

/**
 * Middleware that reads an upload's body as its bytes, which Nest's own parsers leave alone, and
 * answers one over `limitBytes` in the UI's words. Apply it to the upload routes only.
 */
export function uploadBody(limitBytes: number): Middleware {
  const readRaw = express.raw({ type: "application/octet-stream", limit: limitBytes });
  return (request, response, next) => {
    readRaw(request, response, (error?: unknown) => {
      if ((error as { type?: string } | undefined)?.type === "entity.too.large") {
        next(
          new PayloadTooLargeException(`An upload may be at most ${limitBytes / 1024 / 1024} MB.`),
        );
        return;
      }
      next(error);
    });
  };
}

/** The body `uploadBody` read, which is bytes only when it was sent as `application/octet-stream`. */
export function uploadedBytes(body: unknown): Uint8Array {
  if (!Buffer.isBuffer(body)) {
    throw new BadRequestException("Send the file itself as application/octet-stream.");
  }
  return new Uint8Array(body);
}

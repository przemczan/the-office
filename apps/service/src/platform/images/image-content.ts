import type { Readable } from "node:stream";
import { StreamableFile } from "@nestjs/common";
import type { Response } from "express";
import type { ImageMediaType } from "./image-rules.js";

/**
 * Nothing in an opened file may load or run: an SVG can hold a script, and its address sits on The
 * Office's own origin. `<img>` runs nothing anyway; this holds when the address itself is opened.
 */
const IMAGE_CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
/** An image's bytes never change, as a new one gets a new id. */
const IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** An image's bytes as a route answers them, with what keeps them safe to open. */
export function imageContent(
  response: Response,
  mediaType: ImageMediaType,
  content: Readable,
): StreamableFile {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", IMAGE_CONTENT_SECURITY_POLICY);
  response.setHeader("Cache-Control", IMAGE_CACHE_CONTROL);
  return new StreamableFile(content, { type: mediaType, disposition: "inline" });
}

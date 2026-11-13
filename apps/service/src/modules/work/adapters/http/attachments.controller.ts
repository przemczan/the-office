import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UseFilters,
} from "@nestjs/common";
import {
  attachmentUploadQuerySchema,
  isHtmlFile,
  isPlainTextFile,
  newLinkSchema,
  type Attachment as AttachmentResponse,
  type AttachmentUploadQuery,
  type NewLink,
} from "@the-office/contracts";
import type { Response } from "express";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { uploadedBytes } from "../../../../platform/http/upload-body.js";
import { AttachmentService } from "../../application/attachment-service.js";
import type { Attachment, AttachmentOwner } from "../../domain/attachment.js";
import { THE_USER } from "../../domain/author.js";
import { toAttachmentResponse } from "./work-responses.js";
import { WorkRefusalsFilter } from "./work-refusals.filter.js";

/** The routes the upload body is read on; WorkModule applies `uploadBody` to them. */
export const ATTACHMENT_UPLOAD_ROUTES = [
  "ideas/:id/attachments/files",
  "initiatives/:id/attachments/files",
  "tasks/:id/attachments/files",
] as const;

/**
 * An HTML file's address sits on The Office's own origin, so its scripts run in an isolated origin
 * and nothing from outside the file loads into it, opened in a tab as in the preview's frame. It can
 * still navigate away, which no policy stops; the page it leaves for can't reach The Office either.
 */
const HTML_FILE_CONTENT_SECURITY_POLICY =
  "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'";

@Controller()
@UseFilters(WorkRefusalsFilter)
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentService) {}

  @Get("ideas/:id/attachments")
  async listOfIdea(@Param("id", ParseUUIDPipe) id: string): Promise<AttachmentResponse[]> {
    return this.listOf({ kind: "idea", ideaId: id });
  }

  @Get("initiatives/:id/attachments")
  async listOfInitiative(@Param("id", ParseUUIDPipe) id: string): Promise<AttachmentResponse[]> {
    return this.listOf({ kind: "initiative", initiativeId: id });
  }

  @Get("tasks/:id/attachments")
  async listOfTask(@Param("id", ParseUUIDPipe) id: string): Promise<AttachmentResponse[]> {
    return this.listOf({ kind: "task", taskId: id });
  }

  @Post("ideas/:id/attachments/links")
  async addLinkToIdea(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(newLinkSchema)) link: NewLink,
  ): Promise<AttachmentResponse> {
    return this.addLink({ kind: "idea", ideaId: id }, link);
  }

  @Post("initiatives/:id/attachments/links")
  async addLinkToInitiative(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(newLinkSchema)) link: NewLink,
  ): Promise<AttachmentResponse> {
    return this.addLink({ kind: "initiative", initiativeId: id }, link);
  }

  @Post("tasks/:id/attachments/links")
  async addLinkToTask(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(newLinkSchema)) link: NewLink,
  ): Promise<AttachmentResponse> {
    return this.addLink({ kind: "task", taskId: id }, link);
  }

  @Post(ATTACHMENT_UPLOAD_ROUTES[0])
  async addFileToIdea(
    @Param("id", ParseUUIDPipe) id: string,
    @Query(new ContractPipe(attachmentUploadQuerySchema)) query: AttachmentUploadQuery,
    @Body() body: unknown,
  ): Promise<AttachmentResponse> {
    return this.addFile({ kind: "idea", ideaId: id }, query, body);
  }

  @Post(ATTACHMENT_UPLOAD_ROUTES[1])
  async addFileToInitiative(
    @Param("id", ParseUUIDPipe) id: string,
    @Query(new ContractPipe(attachmentUploadQuerySchema)) query: AttachmentUploadQuery,
    @Body() body: unknown,
  ): Promise<AttachmentResponse> {
    return this.addFile({ kind: "initiative", initiativeId: id }, query, body);
  }

  @Post(ATTACHMENT_UPLOAD_ROUTES[2])
  async addFileToTask(
    @Param("id", ParseUUIDPipe) id: string,
    @Query(new ContractPipe(attachmentUploadQuerySchema)) query: AttachmentUploadQuery,
    @Body() body: unknown,
  ): Promise<AttachmentResponse> {
    return this.addFile({ kind: "task", taskId: id }, query, body);
  }

  /**
   * A file's bytes, typed by its kind rather than by the media type it was uploaded with, since it
   * is opened on The Office's own origin: only images, Markdown, other text files as plain text
   * and sandboxed HTML show in the browser. Never kept by the browser unasked, as an Agent's new
   * copy keeps the address (spec §2.1).
   */
  @Get("attachments/:id/content")
  async content(
    @Param("id", ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { attachment, content } = await this.attachments.open(id);
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (isHtmlFile(attachment)) {
      response.setHeader("Content-Security-Policy", HTML_FILE_CONTENT_SECURITY_POLICY);
    }
    return new StreamableFile(content, servingOf(attachment));
  }

  @Delete("attachments/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.attachments.remove(id);
  }

  private async listOf(owner: AttachmentOwner): Promise<AttachmentResponse[]> {
    return (await this.attachments.listOf(owner)).map(toAttachmentResponse);
  }

  private async addLink(owner: AttachmentOwner, link: NewLink): Promise<AttachmentResponse> {
    return toAttachmentResponse(await this.attachments.addLink(owner, link, THE_USER));
  }

  private async addFile(
    owner: AttachmentOwner,
    { fileName, mediaType }: AttachmentUploadQuery,
    body: unknown,
  ): Promise<AttachmentResponse> {
    const file = { name: fileName, mediaType, content: uploadedBytes(body) };
    return toAttachmentResponse(await this.attachments.addFile(owner, file, THE_USER));
  }
}

function servingOf(attachment: Attachment): { type: string; disposition: string } {
  switch (attachment.kind) {
    case "image":
      return { type: attachment.mediaType, disposition: dispositionOf("inline", attachment.name) };
    case "document":
      return {
        type: "text/markdown; charset=utf-8",
        disposition: dispositionOf("inline", attachment.name),
      };
    default:
      if (isHtmlFile(attachment)) {
        return {
          type: "text/html; charset=utf-8",
          disposition: dispositionOf("inline", attachment.name),
        };
      }
      // A text file shows as plain text whatever it was uploaded as, so the browser runs nothing.
      if (isPlainTextFile(attachment)) {
        return {
          type: "text/plain; charset=utf-8",
          disposition: dispositionOf("inline", attachment.name),
        };
      }
      return {
        type: "application/octet-stream",
        disposition: dispositionOf("attachment", attachment.name),
      };
  }
}

/** The file's name in ASCII for old clients, and in full as RFC 6266 and RFC 8187 write it. */
function dispositionOf(kind: "inline" | "attachment", name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

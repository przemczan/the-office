import { Injectable } from "@nestjs/common";
import { extractText } from "unpdf";
import { PdfPages } from "../../ports/pdf-pages.js";

/** PDF.js through unpdf: plain JavaScript, so nothing to install on the workstation. */
@Injectable()
export class UnpdfPdfPages extends PdfPages {
  async textOf(content: Uint8Array): Promise<readonly string[]> {
    // PDF.js takes the bytes it is given over, so it gets a copy of its own.
    const { text } = await extractText(new Uint8Array(content), { mergePages: false });
    return text;
  }
}

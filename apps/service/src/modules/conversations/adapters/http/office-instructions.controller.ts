import { Controller, Get } from "@nestjs/common";
import type { OfficeInstructions as OfficeInstructionsText } from "@the-office/contracts";
import { OfficeInstructions } from "../../application/office-instructions.js";

/** Settings › Office instructions: the text every new session gets. */
@Controller("settings/office-instructions")
export class OfficeInstructionsController {
  constructor(private readonly instructions: OfficeInstructions) {}

  @Get()
  async read(): Promise<OfficeInstructionsText> {
    const { text } = await this.instructions.current();
    return { officeInstructions: text };
  }
}

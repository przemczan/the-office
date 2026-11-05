import { Body, Controller, Get, Put } from "@nestjs/common";
import {
  officeInstructionsSchema,
  type OfficeInstructions as OfficeInstructionsText,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
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

  @Put()
  async change(
    @Body(new ContractPipe(officeInstructionsSchema))
    { officeInstructions }: OfficeInstructionsText,
  ): Promise<OfficeInstructionsText> {
    const { text } = await this.instructions.save(officeInstructions);
    return { officeInstructions: text };
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
} from "@nestjs/common";
import {
  proposalApplicationSchema,
  type Proposal as ProposalResponse,
  type ProposalApplication,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { ProposalService } from "../../application/proposal-service.js";
import type { EditedHire } from "../../domain/proposal.js";
import { toProposalResponse } from "./conversation-responses.js";
import { ThreadRefusalsFilter } from "./thread-refusals.filter.js";

@Controller("proposals")
@UseFilters(ThreadRefusalsFilter)
export class ProposalsController {
  constructor(private readonly proposals: ProposalService) {}

  @Get(":id")
  async read(@Param("id", ParseUUIDPipe) id: string): Promise<ProposalResponse> {
    return toProposalResponse(await this.proposals.read(id));
  }

  /** The user applies it, a new Role's card as they edited it before hiring when they did. */
  @Post(":id/apply")
  @HttpCode(HttpStatus.OK)
  async apply(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(proposalApplicationSchema)) { card }: ProposalApplication,
  ): Promise<ProposalResponse> {
    return toProposalResponse(await this.proposals.apply(id, card && editedHire(card)));
  }

  /** The user declines it ("Not now"): nothing changes. */
  @Post(":id/decline")
  @HttpCode(HttpStatus.OK)
  async decline(@Param("id", ParseUUIDPipe) id: string): Promise<ProposalResponse> {
    return toProposalResponse(await this.proposals.decline(id));
  }
}

/** Splits the card the user sent into the Role card and the skills, as hiring takes them. */
function editedHire({ skills, ...card }: NonNullable<ProposalApplication["card"]>): EditedHire {
  return { card, skills };
}

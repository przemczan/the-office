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
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import { cardWithAuthority, hiredKeyOf } from "../../../people/index.js";
import { ProposalService } from "../../application/proposal-service.js";
import type { EditedHire, Proposal } from "../../domain/proposal.js";
import { toProposalResponse } from "./conversation-responses.js";
import { ThreadRefusalsFilter } from "./thread-refusals.filter.js";

@Controller("proposals")
@UseFilters(ThreadRefusalsFilter)
export class ProposalsController {
  constructor(private readonly proposals: ProposalService) {}

  /** Before `:id`, which would take "open" for an id. */
  @Get("open")
  async listOpen(): Promise<ProposalResponse[]> {
    return (await this.proposals.listOpen()).map((proposal) => this.answer(proposal));
  }

  @Get(":id")
  async read(@Param("id", ParseUUIDPipe) id: string): Promise<ProposalResponse> {
    return this.answer(await this.proposals.read(id));
  }

  /** The signed-in user applies it, a new Role as they edited it before hiring when they did. */
  @Post(":id/apply")
  @HttpCode(HttpStatus.OK)
  async apply(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(proposalApplicationSchema)) application: ProposalApplication,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ProposalResponse> {
    return this.answer(await this.proposals.apply(id, userOf(signedIn), editedHire(application)));
  }

  /** The signed-in user declines it ("Not now"): nothing changes. */
  @Post(":id/decline")
  @HttpCode(HttpStatus.OK)
  async decline(
    @Param("id", ParseUUIDPipe) id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ProposalResponse> {
    return this.answer(await this.proposals.decline(id, userOf(signedIn)));
  }

  /** The Proposal as its card shows it. */
  private answer(proposal: Proposal): ProposalResponse {
    return toProposalResponse(this.proposals.shown(proposal));
  }
}

/**
 * The new Role as the user edited it: a card, split into the Role card and the skills as hiring
 * takes them, its Authority as given or made from its Hard switches, or a name for a preset's Role;
 * undefined when they edited nothing.
 */
function editedHire({ card, name, actionInput }: ProposalApplication): EditedHire | undefined {
  if (actionInput) return { kind: "action-input", input: actionInput };
  if (card) {
    const { skills, ...given } = card;
    const roleKey = hiredKeyOf({ kind: "hire", card: { ...given, authority: {} }, skills });
    return { kind: "hire", card: cardWithAuthority(roleKey, given, {}), skills };
  }
  return name === undefined ? undefined : { kind: "hire-from-preset", name };
}

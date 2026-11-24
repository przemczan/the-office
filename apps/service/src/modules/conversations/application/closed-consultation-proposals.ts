import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  DecisionAnswered,
  DecisionClosed,
  DecisionReopened,
} from "../domain/conversation-events.js";
import { ProposalService } from "./proposal-service.js";

/**
 * Declines the open Proposals of a Consultation on a Task as it closes (spec §2.4.3): once its
 * Decision is answered, taken over, passed on or closed, its tab shows only its note and nobody can
 * open their cards. Also at each start, which declines those a release before this one left open.
 */
@Injectable()
export class ClosedConsultationProposals implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(ClosedConsultationProposals.name);

  constructor(
    private readonly proposals: ProposalService,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    for (const closing of [DecisionAnswered, DecisionClosed, DecisionReopened]) {
      this.events.subscribe(closing, () => this.proposals.declineInClosedConsultations());
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.proposals.declineInClosedConsultations();
    } catch (error) {
      this.logger.error(
        "Declining the Proposals of closed Consultations failed; the next start tries again.",
        error,
      );
    }
  }
}

import { Injectable, type OnModuleInit } from "@nestjs/common";
import { ENDED_INITIATIVE_CONVERSATION_WORDS } from "@the-office/contracts";
import {
  InitiativeThreadSetups,
  type InitiativeThreadRequest,
  type InitiativeThreadSetup,
  type InitiativeThreadSource,
  READING_OFFICE_TOOLS,
} from "../../../conversations/index.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { SHAPING_INSTRUCTIONS } from "../../domain/shaping.js";
import {
  ADD_DEPENDENCY,
  ADD_TASK,
  REMOVE_DEPENDENCY,
  WRITE_OUTCOME,
  WRITE_TASK_DESCRIPTION,
  WRITE_TASK_TITLE,
} from "../office-tools/shaping-office-tools.js";

/**
 * The Office tools of a shaping session: it reads every record and Attachment and changes its own
 * Initiative, straight while it is shaping and by Proposal once it is active; create_task is left
 * out, since a Task made there would be no part of it.
 */
export const SHAPING_OFFICE_TOOLS = [
  ...READING_OFFICE_TOOLS,
  WRITE_OUTCOME,
  ADD_TASK,
  ADD_DEPENDENCY,
  REMOVE_DEPENDENCY,
  WRITE_TASK_TITLE,
  WRITE_TASK_DESCRIPTION,
] as const;

/** Sets up the sessions of Threads on Initiatives for Conversations, from the Initiative's record. */
@Injectable()
export class ShapingThreadSetup implements InitiativeThreadSource, OnModuleInit {
  constructor(
    private readonly setups: InitiativeThreadSetups,
    private readonly initiatives: InitiativeService,
  ) {}

  onModuleInit(): void {
    this.setups.provide(this);
  }

  async setUp({ initiativeId }: InitiativeThreadRequest): Promise<InitiativeThreadSetup> {
    const [initiative, record] = await Promise.all([
      this.initiatives.read(initiativeId),
      this.initiatives.recordText(initiativeId),
    ]);
    return {
      instructions: SHAPING_INSTRUCTIONS,
      officeTools: SHAPING_OFFICE_TOOLS,
      record,
      sessionRefusal: ENDED_INITIATIVE_CONVERSATION_WORDS[initiative.state],
    };
  }
}

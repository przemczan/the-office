import { Injectable, type OnModuleInit } from "@nestjs/common";
import { ENDED_INITIATIVE_CONVERSATION_WORDS } from "@the-office/contracts";
import {
  InitiativeThreadSetups,
  type InitiativeThreadRequest,
  type InitiativeThreadSetup,
  type InitiativeThreadSource,
} from "../../../conversations/index.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { SHAPING_INSTRUCTIONS } from "../../domain/shaping.js";
import {
  ADD_DEPENDENCY,
  ADD_TASK,
  READ_INITIATIVE,
  REMOVE_DEPENDENCY,
  WRITE_OUTCOME,
} from "../office-tools/shaping-office-tools.js";
import { LIST_IDEAS, LIST_TASKS, READ_IDEA, READ_TASK } from "../office-tools/work-office-tools.js";

/**
 * The Office tools of a shaping session: it reads The Office's records and changes its own
 * Initiative, straight while it is shaping and by Proposal once it is active; create_task is left out, since a Task made there would be no part of it.
 */
export const SHAPING_OFFICE_TOOLS = [
  "list_projects",
  "list_people",
  LIST_TASKS,
  READ_TASK,
  LIST_IDEAS,
  READ_IDEA,
  READ_INITIATIVE,
  WRITE_OUTCOME,
  ADD_TASK,
  ADD_DEPENDENCY,
  REMOVE_DEPENDENCY,
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

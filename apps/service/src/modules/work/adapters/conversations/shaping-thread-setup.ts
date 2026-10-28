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

/** The Office tools of a shaping session: it reads The Office's records. */
export const SHAPING_OFFICE_TOOLS = [
  "list_projects",
  "list_people",
  "list_tasks",
  "read_task",
  "list_ideas",
  "read_idea",
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

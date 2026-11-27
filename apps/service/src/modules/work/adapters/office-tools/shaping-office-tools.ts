import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { SessionInitiatives } from "../../ports/session-initiatives.js";
import { answered, WorkToolRefused } from "./work-tool-answers.js";

export const READ_INITIATIVE = "read_initiative";

const NAME_THE_INITIATIVE =
  "This session is on no Initiative: give the id of the Initiative to read.";

/**
 * The Office tool every session reads an Initiative with: `read_initiative` reads any Initiative by
 * its id, in a Thread on one the session's own by default. Shaping one is done with Office actions
 * (WorkOfficeActions: `write_initiative_outcome`, `add_task`, `change_task_title`,
 * `change_task_description`, `choose_pipeline`, its dependencies and which Tasks it has), written
 * as the user's route writes them while it is being shaped and drafted as a Proposal once active.
 */
@Injectable()
export class ShapingOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly initiatives: InitiativeService,
    private readonly sessionInitiatives: SessionInitiatives,
  ) {}

  onModuleInit(): void {
    this.registerReadInitiative();
  }

  private registerReadInitiative(): void {
    this.registry.register({
      name: READ_INITIATIVE,
      description:
        "Reads any Initiative's record as it stands now: its state, the Projects it spans, the Idea it was shaped from, its outcome, its Tasks with what each must wait for, and its Attachments by id. In a Thread on an Initiative it reads that one unless you name another; the user may have changed it since your Brief.",
      input: z.object({
        initiativeId: z
          .string()
          .optional()
          .describe(
            "The Initiative's id, as a Task's or an Idea's record gives it; leave it out in a Thread on an Initiative to read that one.",
          ),
      }),
      run: ({ initiativeId }, { sessionId }) =>
        answered(async () =>
          this.initiatives.recordText(
            initiativeId ?? (await this.initiativeIn(sessionId, NAME_THE_INITIATIVE)),
          ),
        ),
    });
  }

  private async initiativeIn(sessionId: string, onNone: string): Promise<string> {
    const initiativeId = await this.sessionInitiatives.initiativeInSession(sessionId);
    if (initiativeId === undefined) throw new WorkToolRefused(onNone);
    return initiativeId;
  }
}

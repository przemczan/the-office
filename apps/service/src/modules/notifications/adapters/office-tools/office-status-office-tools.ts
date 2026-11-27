import { Injectable, type OnModuleInit } from "@nestjs/common";
import { SHOW_OFFICE_STATUS_TOOL } from "@the-office/contracts";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { NowService } from "../../application/now-service.js";
import { officeStatusText } from "../../domain/office-status.js";
import { OfficeStatusCards } from "../../ports/office-status-cards.js";

const SHOWN =
  "The Office status card is in this Thread, read live whenever the user looks: answer in a line or two, without repeating it. list_people names who fills each Role.";

/**
 * The Office tool the Office Manager shows the Office status with (spec §2.2): Office-wide and
 * read-only, as Now reads it. The card is the user's; the Agent reads the same status in words.
 */
@Injectable()
export class OfficeStatusOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly now: NowService,
    private readonly cards: OfficeStatusCards,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: SHOW_OFFICE_STATUS_TOOL,
      area: "officeSettings",
      description:
        "Shows the user the Office status in this Thread, Office-wide: who is on what and what waits on them. It changes nothing, and gives you the same status in words.",
      input: z.object({}),
      run: async (_input, { sessionId }) => {
        const status = officeStatusText(await this.now.now());
        await this.cards.postOfficeStatus(sessionId);
        return { text: `${status}\n\n${SHOWN}`, isError: false };
      },
    });
  }
}

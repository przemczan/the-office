import { Module, type DynamicModule } from "@nestjs/common";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { FilesystemUpdateFolder } from "./adapters/filesystem/filesystem-update-folder.js";
import { CommandLineOfficeCheckout } from "./adapters/git/command-line-office-checkout.js";
import { OfficeUpdateRefusalsFilter } from "./adapters/http/office-update-refusals.filter.js";
import { OfficeUpdatesController } from "./adapters/http/office-updates.controller.js";
import { OfficeUpdateWebEvents } from "./adapters/websocket/office-update-web-events.js";
import { OfficeUpdates } from "./application/office-updates.js";
import { BusyWorkModule } from "./busy-work.module.js";
import { OfficeCheckout } from "./ports/office-checkout.js";
import { UpdateFolder } from "./ports/update-folder.js";

export interface OfficeUpdatesOptions {
  /** The Office's own git checkout, which its service runs from. */
  readonly checkout: string;
  /** The folder the launcher shares with the service; absent without the launcher. */
  readonly updateFolder: string | undefined;
}

@Module({})
export class OfficeUpdatesModule {
  static register({ checkout, updateFolder }: OfficeUpdatesOptions): DynamicModule {
    return {
      module: OfficeUpdatesModule,
      imports: [ScheduleModule, BusyWorkModule],
      controllers: [OfficeUpdatesController],
      providers: [
        { provide: OfficeCheckout, useValue: new CommandLineOfficeCheckout(checkout) },
        { provide: UpdateFolder, useValue: new FilesystemUpdateFolder(updateFolder) },
        OfficeUpdates,
        OfficeUpdateRefusalsFilter,
        OfficeUpdateWebEvents,
      ],
      exports: [OfficeUpdates],
    };
  }
}

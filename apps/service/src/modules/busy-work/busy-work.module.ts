import { Module } from "@nestjs/common";
import { BusyWork } from "./application/busy-work.js";
import { ScheduledExitHold } from "./application/scheduled-exit-hold.js";

/**
 * What the modules doing the work a scheduled Office update or restart waits for, or holds, import:
 * the busy work they count and the hold they ask. Never `OfficeUpdatesModule`, which needs the
 * app's config.
 */
@Module({ providers: [BusyWork, ScheduledExitHold], exports: [BusyWork, ScheduledExitHold] })
export class BusyWorkModule {}

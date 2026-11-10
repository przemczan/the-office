import { Injectable, type OnModuleInit } from "@nestjs/common";
import { officeUpdateRefusalSchema } from "@the-office/contracts";
import { expect } from "vitest";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { OfficeUpdated, OfficeUpdateFailed } from "../../domain/office-update-events.js";

export async function refusalOf(response: Promise<Response>): Promise<readonly string[]> {
  const answered = await response;
  expect(answered.status).toBe(422);
  return officeUpdateRefusalSchema.parse(await answered.json()).reasons;
}

/** What OfficeUpdates announced as it booted, heard from before the app's bootstrap. */
@Injectable()
export class AnnouncedResults implements OnModuleInit {
  readonly events: (OfficeUpdated | OfficeUpdateFailed)[] = [];

  constructor(private readonly bus: EventBus) {}

  onModuleInit(): void {
    this.bus.subscribe(OfficeUpdated, (event) => void this.events.push(event));
    this.bus.subscribe(OfficeUpdateFailed, (event) => void this.events.push(event));
  }
}

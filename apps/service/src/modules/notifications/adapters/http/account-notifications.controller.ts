import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Put,
} from "@nestjs/common";
import {
  channelSettingSchema,
  notificationTimingSchema,
  type ChannelSetting,
  type NotificationRouting as NotificationRoutingResponse,
  type NotificationTiming as NotificationTimingResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { NotificationDelivery } from "../../application/notification-delivery.js";
import { NotificationRouting } from "../../application/notification-routing.js";
import { isGroup, isRoutingLevel } from "../../domain/notification-kinds.js";
import { toRoutingResponse, toTimingResponse } from "./notification-responses.js";

/** Account › Notifications: the signed-in user's own routing and timing (spec §2.7). */
@Controller("account/notifications")
export class AccountNotificationsController {
  constructor(
    private readonly routing: NotificationRouting,
    private readonly delivery: NotificationDelivery,
  ) {}

  /** When Notifications reach the desktop and the phone: the at-desk hold, quiet hours, batching. */
  @Get("timing")
  async readTiming(@SignedIn() { userId }: SignedIn): Promise<NotificationTimingResponse> {
    return toTimingResponse(await this.delivery.readTiming(userId));
  }

  @Put("timing")
  async setTiming(
    @SignedIn() { userId }: SignedIn,
    @Body(new ContractPipe(notificationTimingSchema))
    { quietHours, ...minutes }: NotificationTimingResponse,
  ): Promise<NotificationTimingResponse> {
    const timing = { ...minutes, quietHours: quietHours ?? undefined };
    return toTimingResponse(await this.delivery.setTiming(userId, timing));
  }

  /** What goes where: every level of the kinds tree with each channel as it routes there. */
  @Get("routing")
  async readRouting(@SignedIn() { userId }: SignedIn): Promise<NotificationRoutingResponse> {
    return toRoutingResponse(await this.routing.read(userId));
  }

  @Put("routing/:level")
  async setChannel(
    @SignedIn() { userId }: SignedIn,
    @Param("level") level: string,
    @Body(new ContractPipe(channelSettingSchema)) { channel, on }: ChannelSetting,
  ): Promise<NotificationRoutingResponse> {
    knownLevel(level);
    return toRoutingResponse(await this.routing.setChannel(userId, level, channel, on));
  }

  /** Gives a kind back to its group; a group has nothing to inherit from. */
  @Delete("routing/:level")
  async reset(
    @SignedIn() { userId }: SignedIn,
    @Param("level") level: string,
  ): Promise<NotificationRoutingResponse> {
    knownLevel(level);
    if (isGroup(level)) throw new BadRequestException(`"${level}" is a group: it can't be reset.`);
    return toRoutingResponse(await this.routing.reset(userId, level));
  }
}

function knownLevel(level: string): void {
  if (!isRoutingLevel(level)) throw new NotFoundException(`There is no kind "${level}".`);
}

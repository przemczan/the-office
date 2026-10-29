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
  type Notification as NotificationResponse,
  type NotificationRouting as NotificationRoutingResponse,
  type NotificationTiming as NotificationTimingResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { NotificationDelivery } from "../../application/notification-delivery.js";
import { NotificationRouting } from "../../application/notification-routing.js";
import { NotificationService } from "../../application/notification-service.js";
import { isGroup, isRoutingLevel } from "../../domain/notification-kinds.js";
import {
  toNotificationResponse,
  toRoutingResponse,
  toTimingResponse,
} from "./notification-responses.js";

@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly routing: NotificationRouting,
    private readonly delivery: NotificationDelivery,
  ) {}

  /** The Notifications not yet cleared, oldest first; raised and cleared ones come as events. */
  @Get()
  async listOpen(): Promise<NotificationResponse[]> {
    return (await this.notifications.listOpen()).map(toNotificationResponse);
  }

  /** When Notifications reach the desktop and the phone: the at-desk hold, quiet hours, batching. */
  @Get("timing")
  async readTiming(): Promise<NotificationTimingResponse> {
    return toTimingResponse(await this.delivery.readTiming());
  }

  @Put("timing")
  async setTiming(
    @Body(new ContractPipe(notificationTimingSchema))
    { quietHours, ...minutes }: NotificationTimingResponse,
  ): Promise<NotificationTimingResponse> {
    const timing = { ...minutes, quietHours: quietHours ?? undefined };
    return toTimingResponse(await this.delivery.setTiming(timing));
  }

  /** What goes where: every level of the kinds tree with each channel as it routes there. */
  @Get("routing")
  async readRouting(): Promise<NotificationRoutingResponse> {
    return toRoutingResponse(await this.routing.read());
  }

  @Put("routing/:level")
  async setChannel(
    @Param("level") level: string,
    @Body(new ContractPipe(channelSettingSchema)) { channel, on }: ChannelSetting,
  ): Promise<NotificationRoutingResponse> {
    knownLevel(level);
    return toRoutingResponse(await this.routing.setChannel(level, channel, on));
  }

  /** Gives a kind back to its group; a group has nothing to inherit from. */
  @Delete("routing/:level")
  async reset(@Param("level") level: string): Promise<NotificationRoutingResponse> {
    knownLevel(level);
    if (isGroup(level)) throw new BadRequestException(`"${level}" is a group: it can't be reset.`);
    return toRoutingResponse(await this.routing.reset(level));
  }
}

function knownLevel(level: string): void {
  if (!isRoutingLevel(level)) throw new NotFoundException(`There is no kind "${level}".`);
}

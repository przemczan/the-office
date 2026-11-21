import { Global, Module } from "@nestjs/common";
import { ScheduleModule } from "../schedule/schedule.module.js";
import { EventStream } from "./event-stream.js";
import { WebEventForwarding } from "./web-event-forwarding.js";
import { WebSocketRoutes } from "./websocket-routes.js";

@Global()
@Module({
  imports: [ScheduleModule],
  providers: [WebEventForwarding, WebSocketRoutes, EventStream],
  exports: [WebEventForwarding, WebSocketRoutes, EventStream],
})
export class EventStreamModule {}

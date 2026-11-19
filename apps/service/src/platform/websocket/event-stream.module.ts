import { Global, Module } from "@nestjs/common";
import { ScheduleModule } from "../schedule/schedule.module.js";
import { EventStream } from "./event-stream.js";
import { WebEventForwarding } from "./web-event-forwarding.js";

@Global()
@Module({
  imports: [ScheduleModule],
  providers: [WebEventForwarding, EventStream],
  exports: [WebEventForwarding, EventStream],
})
export class EventStreamModule {}

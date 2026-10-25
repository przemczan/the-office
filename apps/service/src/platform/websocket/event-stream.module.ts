import { Global, Module } from "@nestjs/common";
import { EventStream } from "./event-stream.js";
import { WebEventForwarding } from "./web-event-forwarding.js";

@Global()
@Module({ providers: [WebEventForwarding, EventStream], exports: [WebEventForwarding] })
export class EventStreamModule {}

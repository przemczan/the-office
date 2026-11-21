import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { DEVICE_RELAY_PATH_PATTERN } from "@the-office/contracts";
import { z } from "zod";
import { WebSocketRoutes } from "../../../../platform/websocket/websocket-routes.js";
import { ConnectedDevices } from "../../application/connected-devices.js";
import { DeviceRelayLink } from "./device-relay-link.js";

const deviceIdSchema = z.uuid();

/** Serves each device's relay socket, signed in, at `DEVICE_RELAY_PATH_PATTERN`. */
@Injectable()
export class DeviceRelayRoute implements OnModuleInit {
  private readonly logger = new Logger(DeviceRelayRoute.name);

  constructor(
    private readonly routes: WebSocketRoutes,
    private readonly devices: ConnectedDevices,
  ) {}

  onModuleInit(): void {
    this.routes.register(DEVICE_RELAY_PATH_PATTERN, (client, _signedIn, params) => {
      const link = new DeviceRelayLink(client);
      const id = deviceIdSchema.safeParse(params["id"]);
      if (!id.success) {
        link.closeAsEnded("There is no such device.");
        return;
      }
      this.devices.relayOpened(id.data, link).catch((error: unknown) => {
        this.logger.error(`The relay of the device ${id.data} didn't open.`, error);
        link.closeAsEnded("The relay didn't open.");
      });
    });
  }
}

import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { ConnectDeviceRefusal } from "@the-office/contracts";
import type { Response } from "express";
import {
  ConnectedDeviceNotFound,
  ConnectedDeviceRefused,
} from "../../domain/connected-device-refused.js";

type DeviceRefusal = ConnectedDeviceRefused | ConnectedDeviceNotFound;

/**
 * A refused connect answers 409 naming the other Task when one holds the device, 422 otherwise,
 * every reason joined into `message` for the web's toast; no such device or Task answers 404.
 */
@Catch(ConnectedDeviceRefused, ConnectedDeviceNotFound)
export class DeviceRefusalsFilter implements ExceptionFilter<DeviceRefusal> {
  catch(error: DeviceRefusal, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof ConnectedDeviceNotFound) {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        message: error.message,
      });
      return;
    }
    const refusal: ConnectDeviceRefusal = {
      statusCode: error.otherTask === undefined ? 422 : 409,
      message: error.message,
      reasons: [...error.reasons],
      otherTask: error.otherTask === undefined ? null : { ...error.otherTask },
    };
    response.status(refusal.statusCode).json(refusal);
  }
}

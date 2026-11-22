import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { ConnectDeviceRefusal, ProjectDeviceRefusal } from "@the-office/contracts";
import type { Response } from "express";
import {
  ConnectedDeviceNotFound,
  ConnectedDeviceRefused,
} from "../../domain/connected-device-refused.js";
import {
  ProjectDeviceNotFound,
  ProjectDeviceRefused,
} from "../../domain/project-device-refused.js";

type DeviceRefusal =
  ConnectedDeviceRefused | ConnectedDeviceNotFound | ProjectDeviceRefused | ProjectDeviceNotFound;

/**
 * A refused connect answers 409 naming the other Task when one holds the device, 422 otherwise;
 * a refused change to a Project device or a lend 409 naming the holder when another environment
 * holds it, 422 otherwise; every reason joined into `message` for the web's toast. No such
 * device, Project device or Task answers 404.
 */
@Catch(ConnectedDeviceRefused, ConnectedDeviceNotFound, ProjectDeviceRefused, ProjectDeviceNotFound)
export class DeviceRefusalsFilter implements ExceptionFilter<DeviceRefusal> {
  catch(error: DeviceRefusal, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof ConnectedDeviceNotFound || error instanceof ProjectDeviceNotFound) {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        message: error.message,
      });
      return;
    }
    if (error instanceof ProjectDeviceRefused) {
      const refusal: ProjectDeviceRefusal = {
        statusCode: error.holder === undefined ? 422 : 409,
        message: error.message,
        reasons: [...error.reasons],
        holder: error.holder === undefined ? null : { ...error.holder },
      };
      response.status(refusal.statusCode).json(refusal);
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

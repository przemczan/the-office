import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
} from "@nestjs/common";
import {
  connectDeviceSchema,
  pairWirelessDeviceSchema,
  type ConnectDevice,
  type ConnectedDevice as ConnectedDeviceResponse,
  type ConnectedDeviceList,
  type PairWirelessDevice,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import { ConnectedDevices } from "../../application/connected-devices.js";
import { noticesOf, type ConnectedDevice } from "../../domain/connected-device.js";
import { DeviceRefusalsFilter } from "./device-refusals.filter.js";

/**
 * A Task's Connected devices (spec §2.13): list, connect, pair over wireless debugging and
 * disconnect, by any signed-in user. A pairing's code is in no response and no log line.
 */
@Controller()
@UseFilters(DeviceRefusalsFilter)
export class DevicesController {
  constructor(private readonly devices: ConnectedDevices) {}

  @Get("tasks/:taskId/devices")
  async list(@Param("taskId", ParseUUIDPipe) taskId: string): Promise<ConnectedDeviceList> {
    return { devices: (await this.devices.list(taskId)).map(deviceResponse) };
  }

  @Post("tasks/:taskId/devices")
  async connect(
    @Param("taskId", ParseUUIDPipe) taskId: string,
    @Body(new ContractPipe(connectDeviceSchema)) given: ConnectDevice,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ConnectedDeviceResponse> {
    return deviceResponse(await this.devices.connect(taskId, given, userOf(signedIn)));
  }

  @Post("tasks/:taskId/devices/wireless")
  async pair(
    @Param("taskId", ParseUUIDPipe) taskId: string,
    @Body(new ContractPipe(pairWirelessDeviceSchema)) given: PairWirelessDevice,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ConnectedDeviceResponse> {
    return deviceResponse(await this.devices.pair(taskId, given, userOf(signedIn)));
  }

  @Post("devices/:id/disconnect")
  @HttpCode(200)
  async disconnect(
    @Param("id", ParseUUIDPipe) id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ConnectedDeviceResponse> {
    return deviceResponse(await this.devices.disconnect(id, "by-user", userOf(signedIn)));
  }
}

export function deviceResponse(device: ConnectedDevice): ConnectedDeviceResponse {
  return {
    id: device.id,
    taskId: device.taskId,
    kind: device.kind,
    name: device.name,
    state: device.state,
    disconnectedBecause: device.disconnectedBecause,
    disconnectedBy: device.disconnectedBy && { ...device.disconnectedBy },
    problem: device.problem,
    endpoint: device.endpoint,
    baudRate: device.baudRate,
    roundTripMs: device.roundTripMs,
    notices: noticesOf(device),
    connectedBy: { ...device.connectedBy },
    connectedAt: device.connectedAt.toISOString(),
    disconnectedAt: device.disconnectedAt?.toISOString() ?? null,
  };
}

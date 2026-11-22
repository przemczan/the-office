import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseFilters,
} from "@nestjs/common";
import {
  addProjectDeviceSchema,
  changeProjectDeviceSchema,
  lendProjectDeviceSchema,
  pairProjectDeviceSchema,
  type AddProjectDevice,
  type ChangeProjectDevice,
  type ConnectedDevice as ConnectedDeviceResponse,
  type LendProjectDevice,
  type PairProjectDevice,
  type ProjectDevice as ProjectDeviceResponse,
  type ProjectDeviceList,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import { ProjectDevices, type SeenProjectDevice } from "../../application/project-devices.js";
import { DeviceRefusalsFilter } from "./device-refusals.filter.js";
import { deviceResponse } from "./devices.controller.js";

/**
 * A Project's devices (spec §2.13, "A Project's device"): list, add, rename or give a new Port,
 * remove, pair again, and lend one to a Task, by any signed-in user. A pairing's code is in no
 * response and no log line; a device's address and Port are only in these responses.
 */
@Controller()
@UseFilters(DeviceRefusalsFilter)
export class ProjectDevicesController {
  constructor(private readonly devices: ProjectDevices) {}

  @Get("projects/:projectId/devices")
  async list(@Param("projectId") projectId: string): Promise<ProjectDeviceList> {
    return { devices: (await this.devices.list(projectId)).map(projectDeviceResponse) };
  }

  @Post("projects/:projectId/devices")
  async add(
    @Param("projectId") projectId: string,
    @Body(new ContractPipe(addProjectDeviceSchema)) given: AddProjectDevice,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ProjectDeviceResponse> {
    return projectDeviceResponse(await this.devices.add(projectId, given, userOf(signedIn)));
  }

  @Patch("project-devices/:id")
  async change(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(changeProjectDeviceSchema)) given: ChangeProjectDevice,
  ): Promise<ProjectDeviceResponse> {
    return projectDeviceResponse(
      await this.devices.change(id, {
        ...(given.name === undefined ? {} : { name: given.name }),
        ...(given.port === undefined ? {} : { port: given.port }),
      }),
    );
  }

  @Delete("project-devices/:id")
  @HttpCode(204)
  async remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.devices.remove(id);
  }

  @Post("project-devices/:id/pair")
  async pair(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(pairProjectDeviceSchema)) given: PairProjectDevice,
  ): Promise<ProjectDeviceResponse> {
    return projectDeviceResponse(await this.devices.pair(id, given));
  }

  @Post("tasks/:taskId/devices/lend")
  async lend(
    @Param("taskId", ParseUUIDPipe) taskId: string,
    @Body(new ContractPipe(lendProjectDeviceSchema)) given: LendProjectDevice,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ConnectedDeviceResponse> {
    return deviceResponse(await this.devices.lend(taskId, given.projectDeviceId, userOf(signedIn)));
  }
}

export function projectDeviceResponse({
  device,
  state,
  inUseBy,
}: SeenProjectDevice): ProjectDeviceResponse {
  return {
    id: device.id,
    projectId: device.projectId,
    kind: device.kind,
    deviceKey: device.deviceKey,
    name: device.name,
    address: device.address,
    port: device.port,
    state,
    inUseBy: inUseBy && { ...inUseBy },
    pairingStep: device.pairingStep,
    pairingProblem: device.pairingProblem,
    addedBy: { ...device.addedBy },
    addedAt: device.addedAt.toISOString(),
    lastUse: device.lastUse && {
      holder: { ...device.lastUse.holder },
      endedAt: device.lastUse.endedAt,
      endedBecause: device.lastUse.endedBecause,
    },
  };
}

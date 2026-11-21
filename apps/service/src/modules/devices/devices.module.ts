import { Module, type DynamicModule, type ModuleMetadata } from "@nestjs/common";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { DevicesController } from "./adapters/http/devices.controller.js";
import { AdbKeyFrames } from "./adapters/device-helper/adb-key-frames.js";
import { PostgresAdbKeyRepository } from "./adapters/postgres/postgres-adb-key-repository.js";
import { PostgresConnectedDeviceRepository } from "./adapters/postgres/postgres-connected-device-repository.js";
import { RunEnvironmentsSettings } from "./adapters/run-environments/run-environments-settings.js";
import { ConnectedDeviceWebEvents } from "./adapters/websocket/connected-device-web-events.js";
import { DeviceRelayRoute } from "./adapters/websocket/device-relay-route.js";
import { WorkDeviceTasks } from "./adapters/work/work-device-tasks.js";
import { AdbInRunEnvironment } from "./application/adb-in-run-environment.js";
import { AndroidUsbDevices } from "./application/android-usb-devices.js";
import { ConnectedDevices } from "./application/connected-devices.js";
import { AdbKeyInput } from "./ports/adb-key-input.js";
import { AdbKeyRepository } from "./ports/adb-key-repository.js";
import { ConnectedDeviceRepository } from "./ports/connected-device-repository.js";
import { DeviceTasks } from "./ports/device-tasks.js";
import { ProjectRunEnvironmentSettings } from "./ports/project-run-environment-settings.js";

export interface DevicesModuleOptions {
  /**
   * Work and Run environments: Work's `TaskService` and `TaskConnectedDevices`, Run environments'
   * `RunEnvironments`, `DeviceHelperFiles`, `RunEnvironmentCommandVariables` and
   * `ProjectRunEnvironments`.
   */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
}

@Module({})
export class DevicesModule {
  static register({ imports }: DevicesModuleOptions): DynamicModule {
    return {
      module: DevicesModule,
      imports: [...imports, ScheduleModule],
      controllers: [DevicesController],
      providers: [
        { provide: ConnectedDeviceRepository, useClass: PostgresConnectedDeviceRepository },
        { provide: AdbKeyRepository, useClass: PostgresAdbKeyRepository },
        { provide: AdbKeyInput, useClass: AdbKeyFrames },
        { provide: DeviceTasks, useClass: WorkDeviceTasks },
        { provide: ProjectRunEnvironmentSettings, useClass: RunEnvironmentsSettings },
        AdbInRunEnvironment,
        AndroidUsbDevices,
        ConnectedDevices,
        ConnectedDeviceWebEvents,
        DeviceRelayRoute,
      ],
      exports: [ConnectedDevices],
    };
  }
}

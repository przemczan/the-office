import { Module, type DynamicModule, type ModuleMetadata } from "@nestjs/common";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { DevicesController } from "./adapters/http/devices.controller.js";
import { ProjectDevicesController } from "./adapters/http/project-devices.controller.js";
import { AdbKeyFrames } from "./adapters/device-helper/adb-key-frames.js";
import { PostgresAdbKeyRepository } from "./adapters/postgres/postgres-adb-key-repository.js";
import { PostgresConnectedDeviceRepository } from "./adapters/postgres/postgres-connected-device-repository.js";
import { PostgresProjectDeviceRepository } from "./adapters/postgres/postgres-project-device-repository.js";
import { ProjectsDeviceFeature } from "./adapters/projects/projects-device-feature.js";
import { ProjectsPairingDefinitions } from "./adapters/projects/projects-pairing-definitions.js";
import { ProjectsRunEnvironmentStart } from "./adapters/projects/projects-run-environment-start.js";
import { RunEnvironmentsPairingStart } from "./adapters/run-environments/run-environments-pairing-start.js";
import { RunEnvironmentsSettings } from "./adapters/run-environments/run-environments-settings.js";
import { ConnectedDeviceWebEvents } from "./adapters/websocket/connected-device-web-events.js";
import { DeviceRelayRoute } from "./adapters/websocket/device-relay-route.js";
import { ProjectDeviceWebEvents } from "./adapters/websocket/project-device-web-events.js";
import { WorkDeviceTasks } from "./adapters/work/work-device-tasks.js";
import { AdbInRunEnvironment } from "./application/adb-in-run-environment.js";
import { AndroidUsbDevices } from "./application/android-usb-devices.js";
import { ConnectedDevices } from "./application/connected-devices.js";
import { ProjectDevices } from "./application/project-devices.js";
import { WirelessDevices } from "./application/wireless-devices.js";
import { AdbKeyInput } from "./ports/adb-key-input.js";
import { AdbKeyRepository } from "./ports/adb-key-repository.js";
import { ConnectedDeviceRepository } from "./ports/connected-device-repository.js";
import { DeviceTasks } from "./ports/device-tasks.js";
import { PairingDefinitions } from "./ports/pairing-definitions.js";
import { PairingEnvironmentStart } from "./ports/pairing-environment-start.js";
import { ProjectDeviceRepository } from "./ports/project-device-repository.js";
import { ProjectDeviceFeature } from "./ports/project-features.js";
import { ProjectRunEnvironmentSettings } from "./ports/project-run-environment-settings.js";
import { RunEnvironmentStart } from "./ports/run-environment-start.js";

export interface DevicesModuleOptions {
  /**
   * Work, Projects and Run environments: Work's `TaskService` and `TaskConnectedDevices`, Projects'
   * `TaskWorktrees`, `ProjectFeatures`, `PairingDefinitionExports` and `ProjectDeviceLines`, Run
   * environments' `RunEnvironments`, `DeviceHelperFiles`, `RunEnvironmentCommandVariables`,
   * `ProjectRunEnvironments` and `PairingEnvironments`.
   */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
}

@Module({})
export class DevicesModule {
  static register({ imports }: DevicesModuleOptions): DynamicModule {
    return {
      module: DevicesModule,
      imports: [...imports, ScheduleModule],
      controllers: [DevicesController, ProjectDevicesController],
      providers: [
        { provide: ConnectedDeviceRepository, useClass: PostgresConnectedDeviceRepository },
        { provide: AdbKeyRepository, useClass: PostgresAdbKeyRepository },
        { provide: AdbKeyInput, useClass: AdbKeyFrames },
        { provide: DeviceTasks, useClass: WorkDeviceTasks },
        { provide: ProjectRunEnvironmentSettings, useClass: RunEnvironmentsSettings },
        { provide: RunEnvironmentStart, useClass: ProjectsRunEnvironmentStart },
        { provide: ProjectDeviceFeature, useClass: ProjectsDeviceFeature },
        { provide: ProjectDeviceRepository, useClass: PostgresProjectDeviceRepository },
        { provide: PairingDefinitions, useClass: ProjectsPairingDefinitions },
        { provide: PairingEnvironmentStart, useClass: RunEnvironmentsPairingStart },
        AdbInRunEnvironment,
        AndroidUsbDevices,
        WirelessDevices,
        ConnectedDevices,
        ProjectDevices,
        ConnectedDeviceWebEvents,
        ProjectDeviceWebEvents,
        DeviceRelayRoute,
      ],
      exports: [ConnectedDevices, ProjectDevices],
    };
  }
}

import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { EngineModule } from "../engine/index.js";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { DevicesInstallDevices } from "./adapters/devices/devices-install-devices.js";
import { TestBuildFilesController } from "./adapters/http/test-build-files.controller.js";
import { TestInstanceOfficeActionsController } from "./adapters/http/test-instance-office-actions.controller.js";
import { TestInstanceOpenController } from "./adapters/http/test-instance-open.controller.js";
import { TestInstanceSettingsController } from "./adapters/http/test-instance-settings.controller.js";
import { TestInstancesController } from "./adapters/http/test-instances.controller.js";
import { TestInstanceOfficeActions } from "./adapters/office-actions/test-instance-office-actions.js";
import { PostgresTestInstanceRepository } from "./adapters/postgres/postgres-test-instance-repository.js";
import { PostgresTestInstanceSettings } from "./adapters/postgres/postgres-test-instance-settings.js";
import { NodeWorkstationAddresses } from "./adapters/network/node-workstation-addresses.js";
import { NodeHttpProxyListeners } from "./adapters/proxy/node-http-proxy-listeners.js";
import { ProjectsTestTargets } from "./adapters/projects/projects-test-targets.js";
import { TestInstanceWebEvents } from "./adapters/websocket/test-instance-web-events.js";
import { WorkInitiatives } from "./adapters/work/work-initiatives.js";
import { InstanceFiles } from "./application/instance-files.js";
import { RunningTestInstances } from "./application/running-test-instances.js";
import { TestBuildLinks } from "./application/test-build-links.js";
import { TestBuildRetention } from "./application/test-build-retention.js";
import { TestInstanceHandOffs } from "./application/test-instance-hand-offs.js";
import { OfficePort, TestInstanceLimits } from "./application/test-instance-limits.js";
import { OfficeHost, TestInstanceProxy } from "./application/test-instance-proxy.js";
import { TestInstances } from "./application/test-instances.js";
import { Initiatives } from "./ports/initiatives.js";
import { InstallDevices } from "./ports/install-devices.js";
import { ProjectTestTargets } from "./ports/project-test-targets.js";
import { ProxyListeners } from "./ports/proxy-listeners.js";
import { SessionPeople } from "./ports/session-people.js";
import { TestInstanceRepository } from "./ports/test-instance-repository.js";
import { TestInstanceSettingsStore } from "./ports/test-instance-settings-store.js";
import { WorkstationAddresses } from "./ports/workstation-addresses.js";

export interface TestInstancesModuleOptions {
  /**
   * Work, Projects, Run environments and Devices: Work's `InitiativeService`, Projects'
   * `ProjectService`, `TestTargets` and `TestInstanceCheckouts`, Run environments'
   * `HostedServices`, Devices' `ProjectDevices`, and Conversations, which keeps the session
   * people behind the Office actions.
   */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  /** The port The Office itself listens on, which the Proxy ports may not hold. */
  readonly officePort: number;
  /**
   * `OFFICE_HOST`, which the test-instance proxy listens on too. It listens only once office.ts
   * calls `TestInstanceProxy.start()`, so a test app opens no Proxy port.
   */
  readonly officeHost: string;
  /** Conversations' `ThreadService`, which knows the person at work in an engine session. */
  readonly sessionPeople: Type<SessionPeople>;
}

@Module({})
export class TestInstancesModule {
  static register({
    imports,
    officePort,
    officeHost,
    sessionPeople,
  }: TestInstancesModuleOptions): DynamicModule {
    return {
      module: TestInstancesModule,
      imports: [...imports, EngineModule, ScheduleModule],
      controllers: [
        TestInstancesController,
        TestInstanceSettingsController,
        TestInstanceOpenController,
        TestInstanceOfficeActionsController,
        TestBuildFilesController,
      ],
      providers: [
        { provide: OfficePort, useValue: new OfficePort(officePort) },
        { provide: OfficeHost, useValue: new OfficeHost(officeHost) },
        { provide: ProxyListeners, useClass: NodeHttpProxyListeners },
        { provide: TestInstanceRepository, useClass: PostgresTestInstanceRepository },
        { provide: TestInstanceSettingsStore, useClass: PostgresTestInstanceSettings },
        { provide: Initiatives, useClass: WorkInitiatives },
        { provide: ProjectTestTargets, useClass: ProjectsTestTargets },
        { provide: InstallDevices, useClass: DevicesInstallDevices },
        { provide: WorkstationAddresses, useClass: NodeWorkstationAddresses },
        { provide: SessionPeople, useExisting: sessionPeople },
        InstanceFiles,
        RunningTestInstances,
        TestBuildLinks,
        TestBuildRetention,
        TestInstanceHandOffs,
        TestInstanceLimits,
        TestInstanceOfficeActions,
        TestInstanceProxy,
        TestInstances,
        TestInstanceWebEvents,
      ],
      exports: [TestInstances, RunningTestInstances, TestInstanceProxy, TestBuildRetention],
    };
  }
}

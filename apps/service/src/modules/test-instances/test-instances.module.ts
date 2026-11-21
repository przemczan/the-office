import { Module, type DynamicModule, type ModuleMetadata } from "@nestjs/common";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { TestBuildFilesController } from "./adapters/http/test-build-files.controller.js";
import { TestInstanceOpenController } from "./adapters/http/test-instance-open.controller.js";
import { TestInstanceSettingsController } from "./adapters/http/test-instance-settings.controller.js";
import { TestInstancesController } from "./adapters/http/test-instances.controller.js";
import { PostgresTestInstanceRepository } from "./adapters/postgres/postgres-test-instance-repository.js";
import { PostgresTestInstanceSettings } from "./adapters/postgres/postgres-test-instance-settings.js";
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
import { ProjectTestTargets } from "./ports/project-test-targets.js";
import { ProxyListeners } from "./ports/proxy-listeners.js";
import { TestInstanceRepository } from "./ports/test-instance-repository.js";
import { TestInstanceSettingsStore } from "./ports/test-instance-settings-store.js";

export interface TestInstancesModuleOptions {
  /**
   * Work, Projects and Run environments: Work's `InitiativeService`, Projects' `ProjectService`,
   * `TestTargets` and `TestInstanceCheckouts`, Run environments' `HostedServices`.
   */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  /** The port The Office itself listens on, which the Proxy ports may not hold. */
  readonly officePort: number;
  /**
   * `OFFICE_HOST`, which the test-instance proxy listens on too. It listens only once office.ts
   * calls `TestInstanceProxy.start()`, so a test app opens no Proxy port.
   */
  readonly officeHost: string;
}

@Module({})
export class TestInstancesModule {
  static register({ imports, officePort, officeHost }: TestInstancesModuleOptions): DynamicModule {
    return {
      module: TestInstancesModule,
      imports: [...imports, ScheduleModule],
      controllers: [
        TestInstancesController,
        TestInstanceSettingsController,
        TestInstanceOpenController,
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
        InstanceFiles,
        RunningTestInstances,
        TestBuildLinks,
        TestBuildRetention,
        TestInstanceHandOffs,
        TestInstanceLimits,
        TestInstanceProxy,
        TestInstances,
        TestInstanceWebEvents,
      ],
      exports: [TestInstances, RunningTestInstances, TestInstanceProxy, TestBuildRetention],
    };
  }
}

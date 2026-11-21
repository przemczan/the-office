export {
  RunEnvironments,
  type RunEnvironmentCommand,
  type SlotOptions,
} from "./application/run-environments.js";
export type { DefinitionWriting } from "./application/definition-files.js";
export {
  HostedServices,
  type HostedService,
  type HostedServiceStart,
  type TestBuildEnd,
  type TestBuildStart,
} from "./application/hosted-services.js";
export type { HostedServiceReadinessOptions } from "./application/hosted-service-readiness.js";
export { RunEnvironmentDefinitions } from "./application/run-environment-definitions.js";
export type {
  DefinitionFile,
  Reading,
  RunEnvironmentDefinition,
} from "./domain/run-environment-definition.js";
export {
  RunEnvironmentCreated,
  RunEnvironmentImageBuilt,
  RunEnvironmentRemoved,
} from "./domain/run-environment-events.js";
export { RunEnvironmentRefused } from "./domain/run-environment-refused.js";
export type {
  CommandEntryPoint,
  CommandEnvironment,
  HostedEntryPoint,
  InstallVariable,
  TaskInWorktree,
} from "./domain/run-environment.js";
export {
  ContainerRuntime,
  type ComposeProject,
  type Execution,
  type ExecutionEnd,
  type Removal,
  type StreamedOutputMask,
} from "./ports/container-runtime.js";
// The end-to-end service's runtime (src/e2e.ts); tests reach it through index.fixtures.ts too.
export { ScriptedContainerRuntime } from "./adapters/scripted/scripted-container-runtime.js";
export {
  RunEnvironmentsModule,
  type RunEnvironmentsModuleOptions,
} from "./run-environments.module.js";

/** Whether a Project's Run environment setting is On (spec §5.5). */
export abstract class ProjectRunEnvironmentSettings {
  abstract isOn(projectId: string): Promise<boolean>;
}

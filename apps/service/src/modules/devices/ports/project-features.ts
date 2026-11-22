/** Whether a Project has Connected devices switched on (spec §2.1.1, "Feature switches"). */
export abstract class ProjectDeviceFeature {
  /**
   * Why a device is refused while Connected devices is switched off for the Project, naming the
   * feature and the Project ("Connected devices are switched off for «…»."); none while it is on.
   */
  abstract switchedOffReasonOf(projectId: string): Promise<string | undefined>;
}

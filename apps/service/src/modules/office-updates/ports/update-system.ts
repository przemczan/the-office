/** The system The Office runs on, as far as updating it goes (spec §5.1 Defaults). */
export abstract class UpdateSystem {
  /** Why The Office can't update itself here, in the UI's words; undefined where it can. */
  abstract readonly refusal: string | undefined;
}

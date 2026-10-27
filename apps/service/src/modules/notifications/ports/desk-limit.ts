/** The Office-wide limit on started Tasks, which Work enforces; the composition root binds it. */
export abstract class DeskLimit {
  abstract officeWideLimit(): Promise<number>;
}

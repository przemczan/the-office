export class OfficeInstructionsVersionNotFound extends Error {
  constructor(readonly version: number) {
    super(`The Office instructions have no version ${version}.`);
    this.name = "OfficeInstructionsVersionNotFound";
  }
}

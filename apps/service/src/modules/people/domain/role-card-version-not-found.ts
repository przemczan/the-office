export class RoleCardVersionNotFound extends Error {
  constructor(
    readonly roleKey: string,
    readonly version: number,
  ) {
    super(`The Role "${roleKey}" has no card version ${version}.`);
    this.name = "RoleCardVersionNotFound";
  }
}

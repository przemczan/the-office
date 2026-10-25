export class RoleNotFound extends Error {
  constructor(readonly roleKey: string) {
    super(`Nobody fills the Role "${roleKey}".`);
    this.name = "RoleNotFound";
  }
}

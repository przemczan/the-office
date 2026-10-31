import type { ProjectServerValue, ProjectServerValuesChange } from "@the-office/contracts";

/**
 * Each Server value's Project value by name, as saving takes it: a plain value's text (empty clears
 * it), a secret's typed value (undefined keeps the one kept, empty removes it).
 */
export type ServerValuesDraft = Readonly<Record<string, string | undefined>>;

/** A plain value starts from its text; a secret's is never shown, so it starts kept. */
export function serverValuesDraftOf(values: readonly ProjectServerValue[]): ServerValuesDraft {
  return Object.fromEntries(
    values.map(({ name, secret, projectValue }) => [
      name,
      secret ? undefined : (projectValue ?? ""),
    ]),
  );
}

/** Every value of the server, since one left out is cleared; a kept secret goes by its name alone. */
export function serverValuesChangeOf(
  values: readonly ProjectServerValue[],
  draft: ServerValuesDraft,
): ProjectServerValuesChange {
  return {
    serverValues: values.map(({ name }) => {
      const projectValue = draft[name];
      return projectValue === undefined ? { name } : { name, projectValue };
    }),
  };
}

/** The Office-wide value as the page shows it: a secret's only as set or not. */
export function officeWideWords({
  secret,
  officeWideValue,
  officeWideValueSet,
}: ProjectServerValue): string {
  if (!officeWideValueSet) return "Not set";
  return secret ? "Set" : (officeWideValue ?? "");
}

/** The Project's value as the page shows it, or that the Office-wide value applies. */
export function projectValueWords({
  secret,
  projectValue,
  projectValueSet,
}: ProjectServerValue): string {
  if (!projectValueSet) return "The Office-wide value";
  return secret ? "Set" : (projectValue ?? "");
}

/** A required value set nowhere leaves the server out of the Project's sessions. */
export function leavesServerOut(value: ProjectServerValue): boolean {
  return value.required && !value.projectValueSet && !value.officeWideValueSet;
}

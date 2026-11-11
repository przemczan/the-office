import type { ProjectCommand } from "@the-office/contracts";

/** The command of a Publish Stage, kept from every Project command's keys. */
export const PUBLISH_COMMAND = "publish";

/** The "Project command" select's value that opens the input for a key no Project has yet. */
export const ANOTHER_KEY = "office:another-key";

/**
 * Where a Script Stage's command choices come from: every Project's commands, in the library and the
 * Stage templates, where each Project runs its own; or the Task's Project's, in a Task's own editor.
 */
export type StageCommandSource =
  | {
      readonly kind: "library";
      readonly projects: readonly {
        readonly name: string;
        readonly commands: readonly Pick<ProjectCommand, "key" | "name">[];
      }[];
    }
  | {
      readonly kind: "project";
      readonly commands: readonly ProjectCommand[];
      /** How Publish ships in the Project, such as "push and open a pull request". */
      readonly publishing: string;
    };

export interface StageCommandChoice {
  readonly value: string;
  readonly label: string;
}

/**
 * The commands a Script Stage may run, as the "Project command" select offers them: the Project's or
 * every Project's, then Publish. A command the Stage names but the choices lack stays listed, so the
 * problem shows instead of the Stage changing. The library also offers "Another key…".
 */
export function commandChoices(current: string, source: StageCommandSource): StageCommandChoice[] {
  const offered = source.kind === "library" ? libraryChoices(source) : projectChoices(source);
  const publish = {
    value: PUBLISH_COMMAND,
    label: source.kind === "project" ? `Publish · ${source.publishing}` : "Publish",
  };
  const listed = [...offered, publish];
  const kept = listed.some(({ value }) => value === current)
    ? []
    : [{ value: current, label: `${current} · ${notOfferedWords(source)}` }];
  const another = source.kind === "library" ? [{ value: ANOTHER_KEY, label: "Another key…" }] : [];
  return [...kept, ...listed, ...another];
}

/**
 * A Script Stage's command as its row reads: Publish, the command's name when the Project is known
 * and has it, and its key otherwise.
 */
export function commandWords(
  command: string,
  commands?: readonly Pick<ProjectCommand, "key" | "name">[],
): string {
  if (command === PUBLISH_COMMAND) return "Publish";
  return commands?.find(({ key }) => key === command)?.name ?? command;
}

/** "test-full · Full tests (the-office)", or "(every Project)" when each has the key. */
function libraryChoices({
  projects,
}: Extract<StageCommandSource, { kind: "library" }>): StageCommandChoice[] {
  const byKey = new Map<string, { name: string; projects: string[] }>();
  for (const project of projects) {
    for (const { key, name } of project.commands) {
      const known = byKey.get(key) ?? { name, projects: [] };
      byKey.set(key, { ...known, projects: [...known.projects, project.name] });
    }
  }
  return [...byKey].map(([key, { name, projects: having }]) => ({
    value: key,
    label: `${key} · ${name} (${having.length === projects.length ? "every Project" : having.join(", ")})`,
  }));
}

/** "Full tests · npm run verify:full", or "· not set" for a line left blank. */
function projectChoices({
  commands,
}: Extract<StageCommandSource, { kind: "project" }>): StageCommandChoice[] {
  return commands.map(({ key, name, commandLine }) => ({
    value: key,
    label: `${name} · ${commandLine === "" ? "not set" : commandLine}`,
  }));
}

function notOfferedWords(source: StageCommandSource): string {
  return source.kind === "project" ? "not in this Project" : "no Project has it";
}

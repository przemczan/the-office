/** Which commands a Role's Agents may run, as their Role card says (spec §6). */
export type RunPermission = "read-only-git" | "project-commands" | "anything";

/** The same, as the engine enforces it: the Project's own commands by their command lines. */
export type CommandPermission =
  | { readonly kind: "read-only-git" }
  | { readonly kind: "project-commands"; readonly commandLines: readonly string[] }
  | { readonly kind: "anything" };

/** What an Agent Stage's session may run: what the engine enforces, and the Brief's words for it. */
export interface AllowedCommands {
  readonly permission: CommandPermission;
  readonly words: string;
}

/**
 * The commands an Agent Stage's session may run, from one source, so the Brief names exactly what
 * the engine allows (research §11.6): an Agent not told is refused and asks a needless Decision.
 * The Project's own commands are all but its install, which is a Hard switch's (spec §6).
 */
export function allowedCommands(
  run: RunPermission,
  projectCommands: Readonly<Record<string, string>>,
  readOnlyGit: readonly string[],
): AllowedCommands {
  const git = `read-only git (${readOnlyGit.map((command) => `git ${command}`).join(", ")})`;
  switch (run) {
    case "read-only-git":
      return { permission: { kind: "read-only-git" }, words: `You may run ${git} only.` };
    case "project-commands": {
      const commands = Object.entries(projectCommands).filter(
        ([key, commandLine]) => key !== "install" && commandLine !== "",
      );
      const lines = commands.map(([key, commandLine]) => `- ${key}: \`${commandLine}\``);
      return {
        permission: {
          kind: "project-commands",
          commandLines: commands.map(([, commandLine]) => commandLine),
        },
        words:
          commands.length === 0
            ? `The Project has no commands to run, so you may run ${git} only.`
            : `You may run the Project's commands, exactly as written, and ${git}:\n\n${lines.join("\n")}`,
      };
    }
    case "anything":
      return {
        permission: { kind: "anything" },
        words: `You may run any command in the worktree, but no git command that changes anything: besides ${git}, git is The Office's.`,
      };
  }
}

import type { Check } from "../../check.ts";
import { SESSION_PLUGIN_NAME } from "../../sandbox.ts";
import { readTranscript } from "../../transcripts.ts";

/** A description as many published skills write it: unquoted, with `: ` inside, so no YAML. */
const COLON_DESCRIPTION = "Test first: red, green, refactor.";
const BODY_FIRST_LINE = "The body's first line.";

/**
 * What the engine makes of frontmatter that isn't YAML, so the library refuses only what the
 * engine would not read as written (spec §2.6). No model call.
 */
export const frontmatterYamlCheck: Check = {
  id: "skills.frontmatter-yaml",
  title: "a session skill whose frontmatter description holds ': ', which no YAML parser reads",
  async run({ sandbox, startSession }) {
    const session = await startSession({
      repository: await sandbox.createRepository(),
      skills: [{ name: "colon", description: COLON_DESCRIPTION, body: BODY_FIRST_LINE }],
    });
    // The listing the model gets is attached at the first turn's start, which needs no model call.
    await session.initWithoutTurn();
    const transcript = await readTranscript(session.repository, session.sessionId);
    const line = transcript
      .flatMap(({ attachment }) =>
        attachment?.type === "skill_listing" && typeof attachment.content === "string"
          ? attachment.content.split("\n")
          : [],
      )
      .find((listing) => listing.startsWith(`- ${SESSION_PLUGIN_NAME}:colon`));
    return {
      listed: line !== undefined,
      descriptionAsWritten: line?.includes(COLON_DESCRIPTION) ?? false,
      descriptionFromBody: line?.includes(BODY_FIRST_LINE) ?? false,
    };
  },
};

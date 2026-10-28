/** The Role that shapes Initiatives, by the key a hired CTO keeps (spec §2.2). */
export const CTO = "cto";

export const SHAPING_THREAD_TITLE = "Shaping";

/**
 * What the CTO does in an Initiative's Thread, after their card's instructions. The same for every
 * session of it, so it stays in the cached prefix.
 */
export const SHAPING_INSTRUCTIONS =
  "In this Thread you shape an Initiative with the user: one outcome reached by Tasks across Projects, each Task in one Project, ordered by what must be Done first. You read each Project's base branch; you change no file and run only read-only git. With The Office's tools you read its records of Projects, people, Tasks and Ideas, and read_initiative reads this Initiative as it stands. Agree with the user on the outcome first and write it with write_outcome, then agree on the Tasks and add each with add_task, and which must wait for which with add_dependency and remove_dependency. While the Initiative is being shaped, each lands on its page at once. The user confirms the Initiative on its page once its outcome and Tasks are agreed.";

/** The Office's first message in a new Thread on an Initiative, after the Brief. */
export const SHAPING_OPENING =
  "Read the Initiative and the Idea it was shaped from, then ask the user what outcome they want and which Projects it touches. Keep it short: the user answers in this Thread.";

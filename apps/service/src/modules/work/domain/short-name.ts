/** The longest a Short name may be (spec 5.5); the contracts carry the same for the web. */
export const SHORT_NAME_MAX_LENGTH = 40;

/** The Initiative's branch in each Project it spans (spec 5.5). */
export function initiativeBranchOf(shortName: string): string {
  return `initiative/${shortName}`;
}

/** The Short name's form: lower-case words of a–z and 0–9, one `-` between each (spec 5.5). */
const SHORT_NAME_FORM = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** How many characters of the Initiative's id stand in for a title with nothing left. */
const ID_FALLBACK_LENGTH = 8;

/**
 * The Short name made from the Initiative's title (spec 5.5): accents dropped, lower-case, each run
 * of other characters one `-`, at most 40 characters cut at a word; the first 8 characters of the
 * id with nothing left. One another Initiative holds gets `-2`, `-3` and so on.
 */
export function derivedShortName(title: string, id: string, taken: ReadonlySet<string>): string {
  const stem =
    cutAtWord(slugOf(title), SHORT_NAME_MAX_LENGTH) || slugOf(id.slice(0, ID_FALLBACK_LENGTH));
  if (!taken.has(stem)) return stem;
  for (let count = 2; ; count += 1) {
    const suffix = `-${count}`;
    const candidate = `${cutAtWord(stem, SHORT_NAME_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Every reason the user's Short name is refused, in words; none when it may be kept. */
export function shortNameProblems(edited: string, taken: ReadonlySet<string>): string[] {
  if (edited === "") return ["Write a Short name: the Initiative's branch is named by it."];
  const problems: string[] = [];
  if (edited.length > SHORT_NAME_MAX_LENGTH) {
    problems.push(
      `A Short name is at most ${SHORT_NAME_MAX_LENGTH} characters; this one has ${edited.length}.`,
    );
  }
  if (!SHORT_NAME_FORM.test(edited)) {
    problems.push(
      "A Short name is lower-case letters a–z and digits 0–9, words joined by a single -, with no - at either end.",
    );
  }
  if (taken.has(edited)) {
    problems.push(`Another Initiative has the Short name ${edited}; choose another.`);
  }
  return problems;
}

/** Lower-case a–z and 0–9 with accents dropped, each run of other characters one `-`, none at the ends. */
function slugOf(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * At most `length` characters, cut at the last `-` that keeps it so; a first word longer than that
 * is cut inside it, as there is no word to cut at.
 */
function cutAtWord(slug: string, length: number): string {
  if (slug.length <= length) return slug;
  const cut = slug.slice(0, length + 1).lastIndexOf("-");
  return cut > 0 ? slug.slice(0, cut) : slug.slice(0, length);
}

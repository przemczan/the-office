/** What a searchable select ranks: an option by its name. */
export interface Named {
  readonly label: string;
}

/** How well a name matches the text typed, the lower the better. */
const MATCH_RANK = { nameStartsWith: 0, wordStartsWith: 1, nameContains: 2 } as const;

type MatchRank = (typeof MATCH_RANK)[keyof typeof MATCH_RANK];

/** None when the name doesn't hold the text. */
function rankOf(label: string, text: string): MatchRank | undefined {
  const name = label.toLocaleLowerCase();
  if (name.startsWith(text)) return MATCH_RANK.nameStartsWith;
  if (name.split(/\s+/).some((word) => word.startsWith(text))) return MATCH_RANK.wordStartsWith;
  if (name.includes(text)) return MATCH_RANK.nameContains;
  return undefined;
}

/**
 * At most `limit` of the options whose name holds the text, case-insensitive, best match first: the
 * name starting with it, then a word in it starting with it, then the name containing it, ties kept
 * in the order given. With no text, the first `limit` options.
 */
export function bestMatches<Option extends Named>(
  options: readonly Option[],
  text: string,
  limit: number,
): Option[] {
  const typed = text.trim().toLocaleLowerCase();
  if (typed === "") return options.slice(0, limit);
  return options
    .flatMap((option) => {
      const rank = rankOf(option.label, typed);
      return rank === undefined ? [] : [{ option, rank }];
    })
    .toSorted((first, second) => first.rank - second.rank)
    .slice(0, limit)
    .map(({ option }) => option);
}

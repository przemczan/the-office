import { useQuery } from "@tanstack/react-query";
import type { Duty, DutyFallback, DutyKey, Role } from "@the-office/contracts";
import { dutyQueries, roleQueries } from "../api/people.ts";

/** Who holds a duty now, as the web reads it (spec §2.2, "Who holds a duty"). */
export interface DutyHolder {
  /** Whoever holds the duty; undefined while nobody does, or until the duties are read. */
  readonly holder: Role | undefined;
  /** The duty's label, as Settings › Duties shows it; empty until the duties are read. */
  readonly label: string;
  /** What applies while nobody holds it; undefined while someone does, or until it is read. */
  readonly fallback: DutyFallback | undefined;
}

/** Who holds `duty`, read from the duties and the Roles. */
export function useDutyHolder(duty: DutyKey): DutyHolder {
  const duties = useQuery(dutyQueries.list()).data;
  const roles = useQuery(roleQueries.list()).data;
  return dutyHolderOf(duty, duties, roles);
}

/** As `useDutyHolder`, from duties and Roles already read. */
export function dutyHolderOf(
  duty: DutyKey,
  duties: readonly Duty[] | undefined,
  roles: readonly Role[] | undefined,
): DutyHolder {
  const holding = duties?.find(({ key }) => key === duty);
  const holderKey = holding?.holder?.roleKey;
  return {
    holder: roles?.find(({ key, letGoAt }) => key === holderKey && letGoAt === null),
    label: holding?.label ?? "",
    fallback: holding?.fallback ?? undefined,
  };
}

/** What applies meanwhile, in the words that follow "Nobody holds <duty>, so …". */
const FALLBACK_WORDS: Readonly<Record<DutyFallback, string>> = {
  user: "it is yours meanwhile",
  caretaker: "the Caretaker stands in meanwhile",
  unstaffed: "the Pipelines whose Stages name it can't start",
};

/** "Nobody holds Plans, so it is yours meanwhile."; the note adds where to choose who. */
export function dutyUnheldWords(label: string, fallback: DutyFallback): string {
  return `Nobody holds ${label}, so ${FALLBACK_WORDS[fallback]}.`;
}

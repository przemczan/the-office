import type { OfficePerson, WorkLink } from "./live-view-types.ts";

/**
 * What a click on someone opens straight away: the Decision waiting on you, which `workLinksOf`
 * puts first, else their one piece of work; null when they have several to choose from.
 */
export function directLinkOf(person: OfficePerson, links: readonly WorkLink[]): WorkLink | null {
  if (person.waitingOnYou.length > 0 || links.length === 1) return links[0] ?? null;
  return null;
}

/** What a click does, as the tooltip ends with it. */
export function pressWords(person: OfficePerson, links: readonly WorkLink[]): string {
  if (person.waitingOnYou.length > 0) return "Click to open the Decision";
  return directLinkOf(person, links) ? "Click to open their work" : "Click to choose which work";
}

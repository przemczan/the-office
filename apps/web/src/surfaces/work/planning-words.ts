/** The Definition of Done as the user writes it, one statement per line; blank lines say nothing. */
export function statementsOf(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

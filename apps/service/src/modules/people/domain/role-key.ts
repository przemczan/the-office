/**
 * The key a Role hired from scratch keeps, from its title: lower case words joined by dashes, so
 * "Data Analyst" is `data-analyst`. Empty when the title has no letters or digits to make one of.
 */
export function roleKeyFor(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

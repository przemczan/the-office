/** Who captured, created or attached something: the user, or a person by the Role they fill. */
export type Author =
  { readonly kind: "user" } | { readonly kind: "person"; readonly roleKey: string };

export const THE_USER: Author = { kind: "user" };

/** The Author as a record names them. */
export function authorWords(author: Author): string {
  return author.kind === "user" ? "the user" : `the person in the Role ${author.roleKey}`;
}

import type { ModelPrice } from "@the-office/contracts";

/** A Model price's four kinds of token, in the order their fields show. */
export const PRICE_KINDS = [
  "input",
  "output",
  "cacheWrites",
  "cacheReads",
] as const satisfies readonly (keyof ModelPrice)[];
export type PriceKind = (typeof PRICE_KINDS)[number];

export const PRICE_KIND_LABELS: Readonly<Record<PriceKind, string>> = {
  input: "Input",
  output: "Output",
  cacheWrites: "Cache writes",
  cacheReads: "Cache reads",
};

/**
 * A Model price as its fields read while the user types: text, since "0.", or a field left
 * empty, isn't a number yet, and $0 is a price, not "no price".
 */
export type ModelPriceText = Readonly<Record<PriceKind, string>>;

export const NO_PRICE_TEXT: ModelPriceText = {
  input: "",
  output: "",
  cacheWrites: "",
  cacheReads: "",
};

export function priceTextOf(price: ModelPrice): ModelPriceText {
  return {
    input: String(price.input),
    output: String(price.output),
    cacheWrites: String(price.cacheWrites),
    cacheReads: String(price.cacheReads),
  };
}

/**
 * What's wrong with one of the fields, or undefined: a price is all four numbers or none, so a
 * field left empty beside a filled one is a problem. A negative price is the service's to refuse.
 */
export function priceFieldProblem(text: ModelPriceText, kind: PriceKind): string | undefined {
  const value = text[kind].trim();
  if (value !== "" && !Number.isFinite(Number(value))) {
    return "Give dollars as a number, such as 3 or 0.3.";
  }
  if (value === "" && PRICE_KINDS.some((each) => text[each].trim() !== "")) {
    return "Give all four, or none for no price.";
  }
  return undefined;
}

/** The price the fields give: null with every field empty, undefined while one has a problem. */
export function priceOf(text: ModelPriceText): ModelPrice | null | undefined {
  if (PRICE_KINDS.some((kind) => priceFieldProblem(text, kind) !== undefined)) return undefined;
  if (PRICE_KINDS.every((kind) => text[kind].trim() === "")) return null;
  return {
    input: Number(text.input),
    output: Number(text.output),
    cacheWrites: Number(text.cacheWrites),
    cacheReads: Number(text.cacheReads),
  };
}

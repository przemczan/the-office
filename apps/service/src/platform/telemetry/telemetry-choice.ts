import type { SavedTelemetryChoice, TelemetryChoice, TelemetryHeader } from "@the-office/contracts";

// An HTTP header name is a token (RFC 9110 §5.6.2).
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
// A value may hold neither a line break nor a NUL, which would end the header.
const HEADER_VALUE_BREAK = /[\r\n\0]/;

/** The choice to save, or why it can't be, in the user's words. */
export type ChoiceToSave =
  | { readonly choice: TelemetryChoice; readonly problems?: undefined }
  | { readonly choice?: undefined; readonly problems: readonly string[] };

/**
 * Checks the choice the user sent and makes it the one to save: an own endpoint must be an http
 * or https URL and its headers valid; `headers` left out keeps the saved ones, and a header sent
 * with an empty value keeps the saved value of the header of that name.
 */
export function choiceToSave(
  sent: TelemetryChoice,
  saved: TelemetryChoice | undefined,
): ChoiceToSave {
  if (sent.kind !== "own-endpoint") return { choice: sent };
  const savedHeaders = saved?.kind === "own-endpoint" ? (saved.headers ?? []) : [];
  const endpoint = sent.endpoint.trim();
  const problems: string[] = [];
  if (!isHttpUrl(endpoint)) {
    problems.push(
      "The endpoint must be an http:// or https:// address, such as https://otlp.example.com.",
    );
  }
  const headers: TelemetryHeader[] = [];
  const names = new Set<string>();
  for (const header of sent.headers ?? savedHeaders) {
    const name = header.name.trim();
    if (!name) {
      problems.push("Every header needs a name.");
      continue;
    }
    if (!HEADER_NAME.test(name)) {
      problems.push(`“${name}” can't be a header's name: use letters, digits and - only.`);
      continue;
    }
    if (names.has(name.toLowerCase())) {
      problems.push(`The header ${name} is given twice.`);
      continue;
    }
    names.add(name.toLowerCase());
    const value =
      header.value === ""
        ? savedHeaders.find((each) => each.name.toLowerCase() === name.toLowerCase())?.value
        : header.value;
    if (value === undefined || value === "") {
      problems.push(`The header ${name} has no value.`);
    } else if (HEADER_VALUE_BREAK.test(value)) {
      problems.push(`The header ${name}'s value can't hold a line break.`);
    } else {
      headers.push({ name, value });
    }
  }
  if (problems.length > 0) return { problems };
  return {
    choice: {
      kind: "own-endpoint",
      endpoint,
      headers,
      ...(sent.timeoutMilliseconds !== undefined && {
        timeoutMilliseconds: sent.timeoutMilliseconds,
      }),
    },
  };
}

/** The saved choice as the browser may see it: its headers by name, never their values. */
export function savedChoiceOf(saved: TelemetryChoice | undefined): SavedTelemetryChoice {
  if (saved === undefined) return { kind: "off" };
  if (saved.kind !== "own-endpoint") return saved;
  return {
    kind: "own-endpoint",
    endpoint: saved.endpoint,
    headerNames: (saved.headers ?? []).map((header) => header.name),
    ...(saved.timeoutMilliseconds !== undefined && {
      timeoutMilliseconds: saved.timeoutMilliseconds,
    }),
  };
}

function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}

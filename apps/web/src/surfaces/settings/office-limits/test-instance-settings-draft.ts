import { testInstanceSettingsSchema, type TestInstanceSettings } from "@the-office/contracts";

/** The fields of the Test instances card a refusal can name. */
export type TestInstanceSettingsField = keyof TestInstanceSettings;

const FIELD_LABELS: Readonly<Record<TestInstanceSettingsField, string>> = {
  testInstancesAtOnce: "Test instances at once",
  idleMinutes: "Idle time",
  firstProxyPort: "First proxy port",
  lastProxyPort: "Last proxy port",
};

/** One thing wrong with the set, the field it names marked on the card. */
export interface SettingsProblem {
  readonly field: TestInstanceSettingsField | undefined;
  /** Its words, led by the field's name. */
  readonly words: string;
}

/** The Proxy ports as typed, before they are saved. */
export interface PortDrafts {
  readonly first: string;
  readonly last: string;
}

export function portDraftsOf(settings: TestInstanceSettings): PortDrafts {
  return { first: String(settings.firstProxyPort), last: String(settings.lastProxyPort) };
}

function isField(name: string): name is TestInstanceSettingsField {
  return name in FIELD_LABELS;
}

function problemOf(field: string | undefined, words: string): SettingsProblem {
  return field !== undefined && isField(field)
    ? { field, words: `${FIELD_LABELS[field]}: ${words}` }
    : { field: undefined, words };
}

/**
 * The set to save with the ports as typed, or what is wrong with it by the contract's own rules,
 * so a port out of range is refused before it is sent; undefined when nothing changed.
 */
export function settingsWithPorts(
  shown: TestInstanceSettings,
  drafts: PortDrafts,
):
  | { readonly settings: TestInstanceSettings }
  | { readonly problems: readonly SettingsProblem[] }
  | undefined {
  const asked = {
    ...shown,
    firstProxyPort: portOf(drafts.first),
    lastProxyPort: portOf(drafts.last),
  };
  if (
    asked.firstProxyPort === shown.firstProxyPort &&
    asked.lastProxyPort === shown.lastProxyPort
  ) {
    return undefined;
  }
  const checked = testInstanceSettingsSchema.safeParse(asked);
  if (checked.success) return { settings: checked.data };
  return {
    problems: checked.error.issues.map((issue) =>
      problemOf(typeof issue.path[0] === "string" ? issue.path[0] : undefined, issue.message),
    ),
  };
}

/** A typed port as a number; anything but digits is not a whole number, so the contract refuses it. */
function portOf(typed: string): number {
  const trimmed = typed.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/**
 * The service's refusal, "firstProxyPort: The Proxy ports can't hold The Office's own port, 4392."
 * (several joined by "; "), each led by its field's name.
 */
export function problemsOfRefusal(message: string): readonly SettingsProblem[] {
  return message.split("; ").map((part) => {
    const [, field, words] = /^(\w+): (.*)$/s.exec(part) ?? [];
    return field !== undefined && words !== undefined && isField(field)
      ? problemOf(field, words)
      : problemOf(undefined, part);
  });
}

/** "20 ports", beside the range; nothing while the range as typed isn't one. */
export function portCountWords(drafts: PortDrafts): string | undefined {
  const first = portOf(drafts.first);
  const last = portOf(drafts.last);
  if (Number.isNaN(first) || Number.isNaN(last) || last < first) return undefined;
  const count = last - first + 1;
  return count === 1 ? "1 port" : `${count} ports`;
}

export function idleWords(minutes: number): string {
  return `${minutes} min`;
}

import type { EntryPoint } from "../../domain/entry-point.js";
import type {
  TestTarget,
  TestTargetKind,
  TestTargetSecret,
  TestTargetSetBy,
  TestTargetVariable,
} from "../../domain/test-target.js";

/** A test target's own fields as its `settings` jsonb holds them: the port or the output patterns. */
export interface StoredTestTargetSettings {
  readonly entryPoint: EntryPoint;
  readonly port?: number;
  readonly outputPatterns?: readonly string[];
  readonly variables: readonly TestTargetVariable[];
  readonly secretVariables: readonly TestTargetSecret[];
}

export interface StoredTestTarget {
  readonly key: string;
  readonly name: string;
  readonly kind: TestTargetKind;
  readonly settings: StoredTestTargetSettings;
  readonly setBy: TestTargetSetBy;
}

export function storedTestTarget(target: TestTarget): StoredTestTarget {
  const { key, name, kind, setBy, entryPoint, variables, secretVariables } = target;
  return {
    key,
    name,
    kind,
    setBy,
    settings: {
      entryPoint,
      ...(target.kind === "build-to-install"
        ? { outputPatterns: target.outputPatterns }
        : { port: target.port }),
      variables,
      secretVariables,
    },
  };
}

export function testTargetOfStored({
  key,
  name,
  kind,
  settings,
  setBy,
}: StoredTestTarget): TestTarget {
  const common = {
    key,
    name,
    entryPoint: settings.entryPoint,
    variables: settings.variables,
    secretVariables: settings.secretVariables,
    setBy,
  };
  return kind === "build-to-install"
    ? { ...common, kind, outputPatterns: settings.outputPatterns ?? [] }
    : { ...common, kind, port: settings.port ?? 0 };
}

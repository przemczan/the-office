import type { EntryPoint } from "../../domain/entry-point.js";
import {
  DEFAULT_PORT_VARIABLE,
  type TestTarget,
  type TestTargetKind,
  type TestTargetSecret,
  type TestTargetSetBy,
  type TestTargetVariable,
} from "../../domain/test-target.js";

/**
 * A test target's own fields as its `settings` jsonb holds them: the port and its variable or the
 * output patterns. A row written before commands before the entry point, the port variable and
 * the target's memory existed has none of them, and reads as their defaults.
 */
export interface StoredTestTargetSettings {
  readonly entryPoint: EntryPoint;
  readonly port?: number;
  readonly portVariable?: string;
  readonly outputPatterns?: readonly string[];
  readonly variables: readonly TestTargetVariable[];
  readonly secretVariables: readonly TestTargetSecret[];
  readonly commandsBefore?: readonly string[];
  readonly memoryMegabytes?: number | null;
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
  const { commandsBefore, memoryMegabytes } = target;
  return {
    key,
    name,
    kind,
    setBy,
    settings: {
      entryPoint,
      ...(target.kind === "build-to-install"
        ? { outputPatterns: target.outputPatterns }
        : { port: target.port, portVariable: target.portVariable }),
      variables,
      secretVariables,
      commandsBefore,
      memoryMegabytes,
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
    commandsBefore: settings.commandsBefore ?? [],
    memoryMegabytes: settings.memoryMegabytes ?? null,
    setBy,
  };
  return kind === "build-to-install"
    ? { ...common, kind, outputPatterns: settings.outputPatterns ?? [] }
    : {
        ...common,
        kind,
        port: settings.port ?? 0,
        portVariable: settings.portVariable ?? DEFAULT_PORT_VARIABLE,
      };
}

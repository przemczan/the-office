export interface ConfigProblem {
  readonly variable: string;
  readonly problem: string;
}

/** Thrown when the environment cannot configure The Office; names every bad variable at once. */
export class InvalidOfficeConfigError extends Error {
  readonly problems: readonly ConfigProblem[];

  constructor(problems: readonly ConfigProblem[]) {
    super(describe(problems));
    this.name = "InvalidOfficeConfigError";
    this.problems = problems;
  }
}

function describe(problems: readonly ConfigProblem[]): string {
  const lines = problems.map(({ variable, problem }) => `  ${variable}: ${problem}`);
  return [
    "The Office cannot start: fix these environment variables (see .env.example).",
    ...lines,
  ].join("\n");
}

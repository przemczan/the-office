import type { Reporter, TestCase } from "vitest/node";

/**
 * Names every test that passed only on a retry (`--retry=1` in `npm run test` and `test:full`), so
 * a flaky test never hides behind the green run. The default reporter prints it nowhere in a summary.
 */
export default class RetriedTestsReporter implements Reporter {
  private readonly retried: string[] = [];

  onTestCaseResult(testCase: TestCase): void {
    if (testCase.diagnostic()?.flaky) {
      this.retried.push(`${testCase.module.moduleId}: ${testCase.fullName}`);
    }
  }

  onTestRunEnd(): void {
    if (this.retried.length === 0) return;
    console.warn(`\nPassed only on a retry (flaky), fix these:\n  ${this.retried.join("\n  ")}`);
  }
}

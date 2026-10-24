import type { Settings } from "@anthropic-ai/claude-agent-sdk";
import type { Check } from "../../check.ts";
import type { ProbeSession } from "../../probe-session.ts";
import { toolCalls } from "../tool-calls.ts";
import { observeCall, type CallObservation } from "./call-observations.ts";

const BASH_DENY_RULE = "Bash(git push *)";
const POWERSHELL_TWIN = "PowerShell(git push *)";

/** Shell rule sets, each started in its own session; the first is the Office's options alone. */
const RULE_SETS: Readonly<Record<string, NonNullable<Settings["permissions"]>>> = {
  officeOptions: {},
  bashDenyRule: { deny: [BASH_DENY_RULE] },
  bashDenyRuleWithTwin: { deny: [BASH_DENY_RULE, POWERSHELL_TWIN] },
  bashDenyRuleWithPowerShellAllowRule: { deny: [BASH_DENY_RULE], allow: ["PowerShell(git status)"] },
  bashAllowRule: { allow: ["Bash(git status)"] },
};

/**
 * The docs say any Bash deny rule turns the PowerShell tool off unless a PowerShell rule exists (spec §6
 * build rules). The tool list comes from `init` at no cost; one turn then shows the twin matches
 * PowerShell commands as its Bash rule matches Bash ones, under an allow rule that would otherwise let
 * `git push` run (it fails harmlessly: the sandbox repository has no remote).
 */
export const powerShellTwinCheck: Check = {
  id: "permissions.powershell-twin",
  title: "a Bash deny rule alone turns the PowerShell tool off, and a PowerShell twin rule keeps it on",
  platforms: ["win32"],
  async run({ sandbox, startSession }) {
    const repository = await sandbox.createRepository();
    const tools = await Promise.all(
      Object.entries(RULE_SETS).map(async ([ruleSet, permissions]) => {
        const session = await startSession({ repository, settings: { permissions } });
        const init = await session.initWithoutTurn();
        return [ruleSet, { bashTool: init.tools.includes("Bash"), powerShellTool: init.tools.includes("PowerShell") }] as const;
      }),
    );
    const twin = await startSession({
      repository,
      settings: { permissions: { deny: [BASH_DENY_RULE, POWERSHELL_TWIN], allow: ["PowerShell(git *)"] } },
    });
    twin.send(
      "Use the PowerShell tool to run `git status`, then the PowerShell tool to run `git push`. " +
        "Do not retry a refused command and do not use any other tool. Then reply with just OK.",
    );
    await twin.nextResult();
    return { tools: Object.fromEntries(tools), twinRuleInForce: { gitStatus: powerShellOutcome(twin, "git status"), gitPush: powerShellOutcome(twin, "git push") } };
  },
};

function powerShellOutcome(session: ProbeSession, command: string): Pick<CallObservation, "outcome" | "permissionDeniedMessage"> {
  const calls = toolCalls(session.messages).filter((call) => call.name === "PowerShell" && String(call.input["command"]).trim().startsWith(command));
  const { outcome, permissionDeniedMessage } = observeCall(session, calls);
  return { outcome, permissionDeniedMessage };
}

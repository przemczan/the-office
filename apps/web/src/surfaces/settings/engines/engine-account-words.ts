import type { EngineAccount } from "@the-office/contracts";

/**
 * A Claude Code engine's account in a line: the email and plan `claude auth status` gives, that a
 * pasted token signs it in (the token tells neither), or "Signed out".
 */
export function engineAccountLine(account: EngineAccount): string {
  if (!account.signedIn) return "Signed out";
  if (account.pastedToken) return "A pasted token signs it in";
  const who = account.email === null ? "Signed in" : `Signed in as ${account.email}`;
  return account.plan === null ? who : `${who} · ${planLabel(account.plan)}`;
}

/** `claude auth status` gives the plan as `max` or `pro`; Claude's own pages call it "Claude Max". */
function planLabel(plan: string): string {
  return `Claude ${plan.charAt(0).toUpperCase()}${plan.slice(1)}`;
}

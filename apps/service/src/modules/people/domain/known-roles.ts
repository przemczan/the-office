/*
 * The keys of spec §2.2's presets, which a Role hired from one keeps. Built-in behaviour goes
 * through the duties' holders (`duties.ts`), each held by one of these keys by default.
 */

export const PLANNER = "planner";

export const DEVELOPER = "developer";

export const REVIEWER = "reviewer";

export const CTO = "cto";

export const DEVOPS = "devops";

export const OFFICE_MANAGER = "office-manager";

/**
 * The built-in person who looks after the workstation and The Office (spec §2.2): always there,
 * never hired or let go, and no preset's.
 */
export const CARETAKER = "caretaker";

import type { TaskLimit } from "@the-office/contracts";
import type { OfficePerson } from "./live-view-types.ts";

interface RosterRole {
  readonly roleKey: string;
  readonly name: string;
  readonly title: string;
  readonly taskLimit: TaskLimit;
  readonly consultant?: boolean;
  readonly chat?: boolean;
}

/** The design's roster, in hire order: today's eight are the first eight. */
export const ROSTER: readonly RosterRole[] = [
  {
    roleKey: "office-manager",
    name: "Pam",
    title: "Office Manager",
    taskLimit: "none",
    chat: true,
  },
  { roleKey: "caretaker", name: "Jan", title: "Caretaker", taskLimit: "none", chat: true },
  { roleKey: "cto", name: "Michael", title: "CTO", taskLimit: 2, consultant: true, chat: true },
  {
    roleKey: "devops",
    name: "Dwight",
    title: "Devops",
    taskLimit: 2,
    consultant: true,
    chat: true,
  },
  {
    roleKey: "planner",
    name: "Angela",
    title: "Planner",
    taskLimit: 2,
    consultant: true,
    chat: true,
  },
  { roleKey: "developer", name: "Jim", title: "Developer", taskLimit: 3 },
  { roleKey: "reviewer", name: "Oscar", title: "Reviewer", taskLimit: 3 },
  {
    roleKey: "ui-ux-designer",
    name: "Stanley",
    title: "UI/UX Designer",
    taskLimit: 3,
    consultant: true,
    chat: true,
  },
  {
    roleKey: "security-reviewer",
    name: "Toby",
    title: "Security Reviewer",
    taskLimit: 2,
    consultant: true,
    chat: true,
  },
  {
    roleKey: "product-manager",
    name: "Holly",
    title: "Product Manager",
    taskLimit: 1,
    consultant: true,
    chat: true,
  },
  { roleKey: "technical-writer", name: "Kelly", title: "Technical Writer", taskLimit: 2 },
  { roleKey: "qa-engineer", name: "Kevin", title: "QA Engineer", taskLimit: 3 },
  { roleKey: "frontend-developer", name: "Erin", title: "Frontend Developer", taskLimit: 3 },
  { roleKey: "backend-developer", name: "Darryl", title: "Backend Developer", taskLimit: 3 },
  { roleKey: "mobile-developer", name: "Andy", title: "Mobile Developer", taskLimit: 2 },
  { roleKey: "data-engineer", name: "Gabe", title: "Data Engineer", taskLimit: 2 },
  {
    roleKey: "release-manager",
    name: "Phyllis",
    title: "Release Manager",
    taskLimit: 1,
    consultant: true,
    chat: true,
  },
  {
    roleKey: "accessibility-reviewer",
    name: "Meredith",
    title: "Accessibility Reviewer",
    taskLimit: 2,
  },
  { roleKey: "performance-engineer", name: "Nellie", title: "Performance Engineer", taskLimit: 2 },
  {
    roleKey: "database-administrator",
    name: "Creed",
    title: "Database Administrator",
    taskLimit: 2,
    consultant: true,
    chat: true,
  },
  { roleKey: "localisation", name: "Karen", title: "Localisation", taskLimit: 2 },
  { roleKey: "copywriter", name: "Ryan", title: "Copywriter", taskLimit: 2 },
  { roleKey: "support", name: "Roy", title: "Support", taskLimit: "none", chat: true },
  { roleKey: "researcher", name: "Clark", title: "Researcher", taskLimit: 2 },
  { roleKey: "illustrator", name: "Pete", title: "Illustrator", taskLimit: 1 },
  { roleKey: "ml-engineer", name: "Jo", title: "ML Engineer", taskLimit: 5 },
  { roleKey: "site-reliability", name: "Hank", title: "Site Reliability", taskLimit: 3 },
  { roleKey: "analyst", name: "Val", title: "Analyst", taskLimit: 2 },
  { roleKey: "integration-tester", name: "Nate", title: "Integration Tester", taskLimit: 4 },
  {
    roleKey: "architect",
    name: "David",
    title: "Architect",
    taskLimit: 2,
    consultant: true,
    chat: true,
  },
];

/** Long enough ago that nobody counts as just joined. */
export const HIRED_LONG_AGO = "2026-01-01T09:00:00.000Z";

/** An idle person of the roster (or any Role key), with what a test overrides. */
export function officePerson(roleKey: string, overrides: Partial<OfficePerson> = {}): OfficePerson {
  const role = ROSTER.find((candidate) => candidate.roleKey === roleKey);
  return {
    roleKey,
    name: role?.name ?? roleKey,
    title: role?.title ?? roleKey,
    state: "idle",
    agents: [],
    consulting: [],
    waitingOnYou: [],
    idleSince: null,
    taskLimit: role?.taskLimit ?? 2,
    consultant: role?.consultant ?? false,
    chat: role?.chat ?? false,
    hiredAt: HIRED_LONG_AGO,
    avatar: null,
    ...overrides,
  };
}

/** The first `count` people of the roster, idle, in hire order. */
export function rosterOf(count: number): OfficePerson[] {
  return ROSTER.slice(0, count).map((role) => officePerson(role.roleKey));
}

/** The floor plans the design was checked on: 3 people (one of them a Developer), 8 and 30. */
export const FLOOR_SIZES = [3, 8, 30] as const;

/** The people of one of the design's floor plans. */
export function floorPeopleOf(count: number): OfficePerson[] {
  return count === 3 ? [...rosterOf(2), officePerson("developer")] : rosterOf(count);
}

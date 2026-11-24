import { defaultPromptTexts, type PromptTexts } from "../../prompt-templates/index.js";
import {
  freshChatThreadBrief,
  freshPersonsThreadBrief,
  initiativeThreadBrief,
  newChatThreadBrief,
  NO_MEMORY,
  taskThreadBrief,
  type BriefMemory,
  type BriefProject,
} from "./brief.js";
import { CONVERSATIONS_PROMPT_TEMPLATES } from "./conversations-prompt-templates.js";
import type { Decision } from "./decision.js";
import { aDecision, THREE_QUESTIONS } from "./decision.fixtures.js";
import type { Message, MessageDraft } from "./message.js";
import {
  caretakerChatInstructions,
  chatInstructions,
  consultationInstructions,
  handoverRequest,
  workThreadInstructions,
} from "./session-instruction-templates.js";
import type { SessionPerson } from "./session-instructions.js";
import { ANN_LEE, BEN_ITO } from "./user.fixtures.js";

/*
 * The representative inputs of Conversations' session instructions and Briefs, each rendered as it
 * is now. `conversations-prompts.golden.ts` holds what each rendered before they became prompt
 * templates; only the calls below follow the functions' signatures.
 */

const PERSON: SessionPerson = {
  card: {
    name: "Jan",
    title: "Planner",
    responsibilities: "Turns what the user wants into Tasks with a Plan.",
    instructions: "Plan small Tasks.\n\nAsk before you split one.",
  },
  officeInstructions: "",
};

const PERSON_WITH_OFFICE_INSTRUCTIONS: SessionPerson = {
  ...PERSON,
  officeInstructions: "# Office preferences\n\n- Use plain language.",
};

const PERSON_WITH_NO_ROLE_INSTRUCTIONS: SessionPerson = {
  card: { ...PERSON.card, instructions: "" },
  officeInstructions: "Be brief.",
};

const IN_THE_THREAD = "In this Thread you plan the Task with the user.";

const BASE_PROJECTS: readonly BriefProject[] = [
  { projectId: "admin-panel", name: "Admin panel", baseBranch: "main", folder: "/office/bases/a" },
  { projectId: "site", name: "Site", baseBranch: "trunk", folder: "/office/bases/site" },
];

const ON_INITIATIVE_BRANCH: readonly BriefProject[] = [
  {
    projectId: "admin-panel",
    name: "Admin panel",
    baseBranch: "main",
    folder: "/office/initiative-bases/sync/admin-panel",
    initiativeBranch: { branch: "initiative/sync", gone: false },
  },
  {
    projectId: "site",
    name: "Site",
    baseBranch: "trunk",
    folder: "/office/bases/site",
    initiativeBranch: { branch: "initiative/sync", gone: true },
  },
];

const GONE_INITIATIVE_BRANCH: readonly BriefProject[] = [
  {
    projectId: "site",
    name: "Site",
    baseBranch: "trunk",
    folder: "/office/bases/site",
    initiativeBranch: { branch: "initiative/sync", gone: true },
  },
];

const ONE_NOTE: BriefMemory = { lines: ["- 2026-11-01: The user likes short Plans."], leftOut: 0 };
const ONE_LEFT_OUT: BriefMemory = { ...ONE_NOTE, leftOut: 1 };
const THREE_LEFT_OUT: BriefMemory = {
  lines: ["- 2026-11-01 (Site): Deploys on Fridays.", "- 2026-11-02 (All Projects): Be brief."],
  leftOut: 3,
};

let position = 0;
function logged(draft: MessageDraft): Message {
  position += 1;
  return { ...draft, id: `m-${position}`, threadId: "t", at: new Date(2026, 9, 25, 10, position) };
}

const say = (text: string, writtenBy = ANN_LEE): Message =>
  logged({ kind: "user", text, delivery: "delivered", writtenBy });
const reply = (text: string): Message => logged({ kind: "person", roleKey: "planner", text });

const LOG: readonly Message[] = [
  say("Can we export the Projects?"),
  reply("Yes: which format?"),
  logged({ kind: "handover-note", roleKey: "planner", text: "Export: format still open." }),
  logged({
    kind: "user",
    text: "CSV, like these two.",
    delivery: "delivered",
    writtenBy: BEN_ITO,
    images: [
      { attachmentId: "image-kept", name: "kept.png", mediaType: "image/png" },
      { attachmentId: "image-gone", name: "gone.png", mediaType: "image/png" },
    ],
  }),
  reply("CSV it is."),
];

const ONLY_A_REMOVED_IMAGE: readonly Message[] = [
  logged({
    kind: "user",
    text: "Like this one.",
    delivery: "delivered",
    writtenBy: ANN_LEE,
    images: [{ attachmentId: "image-gone", name: "gone.png", mediaType: "image/png" }],
  }),
];

const EMPTY_HANDOVER_NOTE: readonly Message[] = [
  say("Hello"),
  logged({ kind: "handover-note", roleKey: "planner", text: "" }),
];

const OVER_THE_CAP: readonly Message[] = [say("older"), reply(`${"a".repeat(13_000)} the end`)];

const REMOVED = new Set(["image-gone"]);

const ANSWERED_AT = new Date("2026-10-25T11:00:00.000Z");

const ANSWERED: readonly Decision[] = [
  aDecision({
    answer: {
      answeredAt: ANSWERED_AT,
      kind: "submitted",
      answers: [{ kind: "option", option: 1, comment: "  Archived too.  " }],
    },
  }),
  aDecision({
    questions: [{ kind: "open", question: "Which years should it cover?" }],
    answer: {
      answeredAt: ANSWERED_AT,
      kind: "submitted",
      answers: [{ kind: "words", text: "2024 and 2025", comment: "Not earlier." }],
      generalComment: "Thanks.",
    },
  }),
  aDecision({
    questions: THREE_QUESTIONS,
    answer: {
      answeredAt: ANSWERED_AT,
      kind: "submitted",
      answers: [
        { kind: "option", option: 0 },
        { kind: "words", text: "Only 2025", comment: "For now." },
        { kind: "option", option: 1 },
      ],
      generalComment: "Ship it.",
    },
  }),
  aDecision({
    answer: {
      answeredAt: ANSWERED_AT,
      kind: "asked-again",
      generalComment: "Ask about formats first.",
    },
  }),
  aDecision({ answer: undefined }),
];

const OPEN = aDecision({ questions: THREE_QUESTIONS });

/** Each case's output, by a name that says its input, rendered with `prompts`. */
export function goldenCaseOutputs(
  prompts: PromptTexts = defaultPromptTexts(CONVERSATIONS_PROMPT_TEMPLATES),
): Readonly<Record<string, string>> {
  return {
    "work thread instructions, no Office instructions": workThreadInstructions(
      prompts,
      PERSON,
      IN_THE_THREAD,
    ),
    "work thread instructions, Office instructions": workThreadInstructions(
      prompts,
      PERSON_WITH_OFFICE_INSTRUCTIONS,
      IN_THE_THREAD,
    ),
    "work thread instructions, empty Role instructions": workThreadInstructions(
      prompts,
      PERSON_WITH_NO_ROLE_INSTRUCTIONS,
      IN_THE_THREAD,
    ),
    "work thread instructions, neither Office nor Role instructions": workThreadInstructions(
      prompts,
      { ...PERSON, card: { ...PERSON.card, instructions: "" } },
      IN_THE_THREAD,
    ),
    "chat instructions, no duty": chatInstructions(prompts, PERSON, []),
    "chat instructions, Default person to talk to": chatInstructions(
      prompts,
      PERSON_WITH_OFFICE_INSTRUCTIONS,
      ["default-person-to-talk-to"],
    ),
    "chat instructions, onboards Projects": chatInstructions(prompts, PERSON, [
      "onboards-projects",
    ]),
    "chat instructions, both": chatInstructions(prompts, PERSON, [
      "default-person-to-talk-to",
      "shapes-initiatives",
      "onboards-projects",
    ]),
    "Caretaker instructions, changes allowed": caretakerChatInstructions(prompts, PERSON, true),
    "Caretaker instructions, changes not allowed": caretakerChatInstructions(
      prompts,
      PERSON_WITH_OFFICE_INSTRUCTIONS,
      false,
    ),
    "Consultation instructions, can call": consultationInstructions(prompts, PERSON, true),
    "Consultation instructions, can't call": consultationInstructions(prompts, PERSON, false),
    "Consultation instructions, onboards Projects on a Task, writes the run environment":
      consultationInstructions(prompts, PERSON, true, {
        onboardsProjects: true,
        onTask: true,
        writesRunEnvironment: true,
      }),
    "Consultation instructions, onboards Projects on a Task": consultationInstructions(
      prompts,
      PERSON,
      true,
      { onboardsProjects: true, onTask: true, writesRunEnvironment: false },
    ),
    "Consultation instructions, onboards Projects on no Task": consultationInstructions(
      prompts,
      PERSON,
      false,
      { onboardsProjects: true, onTask: false, writesRunEnvironment: false },
    ),
    "Handover request": handoverRequest(prompts),
    "new chat Brief, no Project": newChatThreadBrief(prompts, [], NO_MEMORY).text,
    "new chat Brief, base branches, one note": newChatThreadBrief(prompts, BASE_PROJECTS, ONE_NOTE)
      .text,
    "new chat Brief, Initiative branch, one left out": newChatThreadBrief(
      prompts,
      ON_INITIATIVE_BRANCH,
      ONE_LEFT_OUT,
    ).text,
    "new chat Brief, gone Initiative branch, three left out": newChatThreadBrief(
      prompts,
      GONE_INITIATIVE_BRANCH,
      THREE_LEFT_OUT,
    ).text,
    "new chat Brief, nothing but notes left out": newChatThreadBrief(prompts, BASE_PROJECTS, {
      lines: [],
      leftOut: 2,
    }).text,
    "fresh chat Brief, title missing, images": freshChatThreadBrief(prompts, {
      title: undefined,
      log: LOG,
      removedImages: REMOVED,
      projects: BASE_PROJECTS,
      memory: ONE_NOTE,
    }).text,
    "fresh chat Brief, empty title, empty Handover note": freshChatThreadBrief(prompts, {
      title: "",
      log: EMPTY_HANDOVER_NOTE,
      projects: [],
      memory: NO_MEMORY,
    }).text,
    "fresh chat Brief, only a removed image": freshChatThreadBrief(prompts, {
      title: "Export",
      log: ONLY_A_REMOVED_IMAGE,
      removedImages: REMOVED,
      projects: BASE_PROJECTS,
      memory: NO_MEMORY,
    }).text,
    "fresh chat Brief, over the cap": freshChatThreadBrief(prompts, {
      title: "Export",
      log: OVER_THE_CAP,
      projects: BASE_PROJECTS,
      memory: THREE_LEFT_OUT,
    }).text,
    "fresh chat Brief, no log": freshChatThreadBrief(prompts, {
      title: "Export",
      log: [],
      projects: BASE_PROJECTS,
      memory: NO_MEMORY,
    }).text,
    "fresh person's Thread Brief, title missing, images": freshPersonsThreadBrief(prompts, {
      title: undefined,
      log: LOG,
      removedImages: REMOVED,
      memory: ONE_LEFT_OUT,
    }).text,
    "fresh person's Thread Brief, empty title, empty Handover note": freshPersonsThreadBrief(
      prompts,
      {
        title: "",
        log: EMPTY_HANDOVER_NOTE,
        memory: NO_MEMORY,
      },
    ).text,
    "fresh person's Thread Brief, over the cap": freshPersonsThreadBrief(prompts, {
      title: "Export",
      log: OVER_THE_CAP,
      memory: ONE_NOTE,
    }).text,
    "Task Thread Brief, first session, nothing answered": taskThreadBrief(prompts, {
      record: "## The Task\n\nExport the Projects.",
      continuing: false,
      answered: [],
      open: undefined,
      memory: NO_MEMORY,
    }).text,
    "Task Thread Brief, continuing, answered and open": taskThreadBrief(prompts, {
      record: "## The Task\n\nExport the Projects.",
      continuing: true,
      answered: ANSWERED,
      open: OPEN,
      memory: ONE_LEFT_OUT,
    }).text,
    "Initiative Thread Brief, open Decision put to the user": initiativeThreadBrief(prompts, {
      record: "## The Initiative\n\nSync.",
      continuing: true,
      memory: ONE_NOTE,
      projects: ON_INITIATIVE_BRANCH,
      open: aDecision({ taskId: undefined, questions: THREE_QUESTIONS }),
    }).text,
    "Initiative Thread Brief, open Decision put to a Role": initiativeThreadBrief(prompts, {
      record: "## The Initiative\n\nSync.",
      continuing: false,
      memory: NO_MEMORY,
      projects: [],
      open: aDecision({ taskId: undefined, putTo: "cto" }),
    }).text,
  };
}

import { isApproval, type Decision, type DecisionAnswer, type DecisionDraft } from "./decision.js";

/** Who asks a Decision no person opened, such as a Pipeline's (spec §2.3). */
export const THE_OFFICE = "The Office";

/**
 * The answers to a request for approval of a call past a Hard switch (spec §6). There is never an
 * "always": widening what a Role may do is a change to its Role card.
 */
export const APPROVAL_OPTIONS = ["Allow once", "Deny"] as const;

/** The question an approval of `call` is asked with, which a granted approval is found by. */
export function approvalQuestion(call: string): string {
  return `Allow this call? ${call}`;
}

/**
 * How many people may be asked down one chain of calls, counting nested calls and passes-on
 * together (spec §2.2): such as Planner → Devops → CTO, or Devops → CTO → the user.
 */
export const CALL_STEPS = 2;

/**
 * What an Agent asks the person it consults: a question, approval of a call, or a request, asking
 * them to do something they can and the Agent can't (spec §2.2).
 */
export type Consult =
  | {
      readonly kind: "question";
      /**
       * Whom the Agent would consult, as its brief names them, such as Devops; undefined when it
       * asks the user, as a Hard switch set to Ask me says.
       */
      readonly person?: string;
      readonly question: string;
      readonly context: string;
      readonly options: readonly string[];
      /** The recommended option, by its index in `options`. */
      readonly recommended: number;
      readonly why: string;
    }
  | {
      readonly kind: "approval";
      readonly person?: string;
      /** The call the Agent asks to make, as the user reads it. */
      readonly call: string;
      readonly context: string;
      /** Why the Agent needs the call. */
      readonly why: string;
    }
  | {
      readonly kind: "request";
      readonly person?: string;
      /** What the Agent asks them to do, as the user reads it. */
      readonly request: string;
      readonly context: string;
      /** Why the Agent needs it done. */
      readonly why: string;
    };

/** Whom a consult is put to: a Consultant who answers it, or the user in their place. */
export type ConsultedParty =
  { readonly kind: "consultant"; readonly roleKey: string } | { readonly kind: "user" };

/** A person hired now whose Consultant capability is on. */
export interface ConsultantPerson {
  readonly roleKey: string;
  readonly name: string;
  readonly title: string;
}

/**
 * The Consultant a consult names, found by their Role's key, title or name, however the Agent's
 * brief wrote it. Nobody when it names no one, a person who isn't a Consultant or isn't hired, or
 * the asking person themselves: the consult then falls back to the user (spec §2.2).
 */
export function consultantNamed(
  person: string | undefined,
  consultants: readonly ConsultantPerson[],
  askerRoleKey: string,
): ConsultantPerson | undefined {
  const wanted = person?.trim().toLowerCase();
  if (!wanted) return undefined;
  return consultants.find(
    ({ roleKey, name, title }) =>
      roleKey !== askerRoleKey &&
      [roleKey, title, name].some((candidate) => candidate.toLowerCase() === wanted),
  );
}

/**
 * A chain of calls (spec §2.2): the first asker, every asker up its Consultations, and everyone a
 * Decision down it was put to or passed on to, by the keys of their Roles; and how many people it
 * has asked so far.
 */
export interface CallChain {
  readonly roleKeys: readonly string[];
  readonly steps: number;
}

/**
 * The chain a call by `askerRoleKey` would join: `above` holds the Decisions the asker's Thread
 * answers, its Consultation's first, then the one that Consultation's asker answers, and so on up;
 * none for a Thread that is no Consultation. For a pass-on, `above` starts with the Decision passed
 * on. The Office asks no one down a chain, so it is in none.
 */
export function callChain(askerRoleKey: string | undefined, above: readonly Decision[]): CallChain {
  const roleKeys = new Set<string>(askerRoleKey === undefined ? [] : [askerRoleKey]);
  let steps = 0;
  for (const { roleKey, putTo, passedOn } of above) {
    for (const key of [roleKey, ...passedOn.map((passer) => passer.roleKey), putTo]) {
      if (key !== undefined) roleKeys.add(key);
    }
    steps += passedOn.length + (putTo === undefined ? 0 : 1);
  }
  return { roleKeys: [...roleKeys], steps };
}

/** Whether a chain may ask one more person: fewer than `CALL_STEPS` were asked down it. */
export function canCall({ steps }: CallChain): boolean {
  return steps < CALL_STEPS;
}

/** Every problem with calling `callee` down the chain, in words the Agent acts on (spec §2.2). */
export function callProblems(chain: CallChain, callee: ConsultantPerson): string[] {
  if (chain.roleKeys.includes(callee.roleKey)) {
    return [
      `${callee.name} is already in this chain of calls: answer from what you have, or pass it on to the user.`,
    ];
  }
  if (!canCall(chain)) {
    return [
      `This chain of calls has asked ${CALL_STEPS} people already, the most it may: answer from what you have, or pass it on to the user.`,
    ];
  }
  return [];
}

/** Where a Decision passed on goes: to a Consultant, to the user, or nowhere, refused. */
export type PassingOnTo =
  | { readonly kind: "consultant"; readonly consultant: ConsultantPerson }
  | { readonly kind: "user" }
  | { readonly kind: "refused"; readonly problems: readonly string[] };

/**
 * Where the Decision passed on goes, `chain` being the one it is in: to the Consultant the passing
 * one names, refused when that person is already in the chain. To the user when they name nobody
 * who can be consulted, or once the chain has asked `CALL_STEPS` people (spec §2.2: nothing is
 * passed back down).
 */
export function passedOnTo(
  decision: Decision,
  person: string | undefined,
  consultants: readonly ConsultantPerson[],
  chain: CallChain,
): PassingOnTo {
  // The Office puts its own Decision to the CTO, the top of the steps, before the user (spec §2.3).
  if (decision.roleKey === undefined) return { kind: "user" };
  const named = consultantNamed(person, consultants, decision.putTo ?? "");
  if (!named || !canCall(chain)) return { kind: "user" };
  const problems = callProblems(chain, named);
  return problems.length > 0
    ? { kind: "refused", problems }
    : { kind: "consultant", consultant: named };
}

/**
 * The Decision a consult opens, naming whom the Agent would have consulted when the user answers in
 * their place (spec §6: a missing person falls back to the user). The Consultant is asked the same
 * question without that line.
 */
export function consultDecision(consult: Consult, party: ConsultedParty): DecisionDraft {
  const person = consult.person?.trim();
  const context =
    person && party.kind === "user"
      ? `For ${person}: nobody who can be consulted fills that Role, so you answer in their place.\n\n${consult.context}`
      : consult.context;
  switch (consult.kind) {
    case "question":
      return {
        kind: "question",
        question: consult.question,
        context,
        options: consult.options,
        recommendation: { option: consult.recommended, reason: consult.why },
      };
    case "approval":
      return {
        kind: "approval",
        question: approvalQuestion(consult.call),
        context,
        options: APPROVAL_OPTIONS,
        recommendation: { option: 0, reason: consult.why },
      };
    case "request":
      return {
        kind: "request",
        question: consult.request,
        context,
        options: [],
        recommendation: { option: 0, reason: consult.why },
      };
  }
}

/**
 * Every problem with a Consultant's answer. The Office's Decision, put to the CTO first, they
 * answer only in their own words, which send the Task back for one more round: its options stay
 * the user's (spec §2.3).
 */
export function consultantAnswerProblems(decision: Decision, answer: DecisionAnswer): string[] {
  if (decision.roleKey !== undefined || answer.kind !== "option") return [];
  return [
    "Its options are the user's. Answer in your own words to send the Task back for one more round with them as its guidance, or pass it on to the user.",
  ];
}

/** The title of a Consultation, labelled with both people (spec §2.4). */
export function consultationTitle(askerName: string, consultantName: string): string {
  return `Consultation · ${askerName} and ${consultantName}`;
}

/**
 * What The Office asks the Consultant when their Consultation opens: the Decision as the Agent put
 * it, who passed it on to them and why, and how to answer.
 */
export function consultationOpening(
  decision: Decision,
  askerName: string,
  passers: readonly { readonly name: string; readonly reason: string }[] = [],
): string {
  if (decision.roleKey === undefined) return officeConsultationOpening(decision);
  const passedOn = passers.map(({ name, reason }) => `${name} passed it on to you: ${reason}`);
  if (decision.kind === "request") return requestOpening(decision, askerName, passedOn);
  const options = decision.options
    .map(
      (option, index) =>
        `${index + 1}. ${option}${index === decision.recommendation.option ? " (recommended)" : ""}`,
    )
    .join("\n");
  const howToAnswer = isApproval(decision)
    ? "Answer with the answer_consultation tool: choose Allow once or Deny by its number, or pass it on when the call isn't yours to decide. It reaches them as their next message."
    : "Answer with the answer_consultation tool: choose one of the options by its number, or give an answer in your own words. It reaches them as their next message.";
  return [
    `${askerName} asks for your answer${onItsTask(decision)}.`,
    ...passedOn,
    `Question: ${decision.question}`,
    `What they found: ${decision.context}`,
    `Their options:\n${options}`,
    `Why they recommend the option they do: ${decision.recommendation.reason}`,
    howToAnswer,
  ].join("\n\n");
}

/**
 * What the callee of a request is asked (spec §2.2): what the asker asks them to do, why, and that
 * they answer in their own words with what they did, using their own tools, or why they can't.
 */
function requestOpening(
  decision: Decision,
  askerName: string,
  passedOn: readonly string[],
): string {
  return [
    `${askerName} asks you to: ${decision.question}`,
    ...passedOn,
    `What they found: ${decision.context}`,
    `Why they need it: ${decision.recommendation.reason}`,
    `Do it with your own tools${onItsTask(decision)}, then answer with the answer_consultation tool in your own words: what you did, such as a Proposal you drafted for the user to apply, or why you can't. It reaches them as their next message.`,
  ].join("\n\n");
}

function onItsTask({ taskId }: Decision): string {
  return taskId === undefined ? "" : " on this Task";
}

/** The visible line a Consultation opens with: what its Consultant is asked (spec §2.4). */
export function consultationAskedLine(askerName: string, decision: Decision): string {
  switch (decision.kind) {
    case "request":
      return `${askerName} asks you to: ${decision.question}`;
    case "approval":
      return `${askerName} asks your approval: ${decision.question}`;
    case "question":
      return `${askerName} asks: ${decision.question}`;
  }
}

/** The visible line a Consultation logs once its callee answered (spec §2.4). */
export function consultationAnswerLine(askerName: string, answerWords: string): string {
  return `Your answer to ${askerName}: ${answerWords}`;
}

/**
 * What The Office answers a call made from a chat that fell back to the user, as a chat has no
 * Needs you (spec §2.4): the caller asks the user in their reply.
 */
export function backToTheCallerWords(why: string): string {
  return `${why} So it is the user's now: ask them in your reply.`;
}

/**
 * What The Office asks the Consultant it puts its own Decision to first (spec §2.3): what happened,
 * the user's options for them to know, and their two answers.
 */
function officeConsultationOpening(decision: Decision): string {
  const options = decision.options.map((option, index) => `${index + 1}. ${option}`).join("\n");
  return [
    `${THE_OFFICE} asks for your answer on this Task before the user's.`,
    `Question: ${decision.question}`,
    `What happened: ${decision.context}`,
    `The user's options, which stay theirs:\n${options}`,
    "Answer with the answer_consultation tool in your own words: they send the Task back for one more round, as its guidance. Or pass it on to the user when it isn't yours to decide, saying why.",
  ].join("\n\n");
}

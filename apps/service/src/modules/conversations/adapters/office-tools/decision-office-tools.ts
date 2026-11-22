import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  ANSWER_CONSULTATION_TOOL,
  ANSWER_DECISION_TOOL,
  CONSULT_TOOL,
  OPEN_DECISION_TOOL,
} from "@the-office/contracts";
import { z } from "zod";
import { OfficeToolRegistry, type OfficeToolResult } from "../../../engine/index.js";
import { Consultations } from "../../application/consultations.js";
import { DecisionService } from "../../application/decision-service.js";
import { WorkRecords } from "../../application/work-records.js";
import { APPROVAL_OPTIONS, CALL_STEPS, type Consult } from "../../domain/consult.js";
import {
  decisionSummary,
  formAnswerWords,
  type DecisionAnswer,
  type DecisionDraft,
  type DecisionQuestion,
  type QuestionAnswer,
} from "../../domain/decision.js";
import { DecisionNotFound } from "../../domain/decision-not-found.js";
import { ThreadRefused } from "../../domain/thread-refused.js";
import { userWords } from "../../domain/user.js";

const END_YOUR_TURN =
  "End your turn now: their answer, or a follow-up question, comes as your next message.";

/**
 * The Office tools an Agent asks with, in a Thread on a Task (spec §2.4, §6): it opens a Decision,
 * or consults a person, whose Consultation answers a Decision put to them; a Consultant gives their
 * answer with the third. Asking returns at once: the Agent ends its turn, and the answer comes as
 * its next message (spec §9). The Planner opens Decisions in an Initiative's planning Thread too,
 * each on one of its Tasks, and plans on while they wait, or one on the Initiative as a whole; the
 * shaper opens one at a time in the shaping Thread, on the Initiative. A person the user talks to answers a
 * Decision waiting on the user for them, when the user asks them to, with the fourth (spec §2.4).
 */
@Injectable()
export class DecisionOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly decisions: DecisionService,
    private readonly consultations: Consultations,
    private readonly work: WorkRecords,
  ) {}

  onModuleInit(): void {
    this.registerOpenDecision();
    this.registerConsult();
    this.registerAnswerConsultation();
    this.registerAnswerDecision();
  }

  private registerOpenDecision(): void {
    this.registry.register({
      name: OPEN_DECISION_TOOL,
      description:
        "Opens a Decision in this Thread when something is the user's to decide: ask everything you need in one Decision, as a form of one or more questions, each with its options and the one you recommend (set several when they may pick more than one, and recommend each you would pick), or with none for a question they answer in their own words. The user answers each question, with an optional comment on each and a general comment, then Submits, or asks you again instead; they may ask you a follow-up first. It returns at once; then end your turn without asking the questions again. Their answer comes as your next message. In your chat it shows inline, and the user answers it there. In an Initiative's shaping Thread leave taskId out: the Decision is on the Initiative, one at a time. In its planning Thread name the Task it is on with taskId: several can be open there, one per Task, and you plan on meanwhile; or leave taskId out for the Initiative as a whole, one at a time.",
      input: z.object({
        context: z
          .string()
          .describe("What the user needs to know to decide: what you found, in a few lines."),
        questions: QUESTIONS_INPUT,
        attachments: z
          .array(z.string())
          .optional()
          .describe(
            "The Task's Attachments this Decision is about, of any kind, by their ids, for the user to see on its card; the Initiative's for one on the Initiative. Leave it out when it is about none.",
          ),
        taskId: z
          .string()
          .optional()
          .describe(
            "In an Initiative's planning Thread, the Task the Decision is on: one of the Initiative's Tasks, by its id (one open per Task); leave it out for the Initiative as a whole (one at a time). Leave it out in the Initiative's shaping Thread, where a Decision is on the Initiative (one at a time), and in a Thread on a Task, where it is on that Task.",
          ),
      }),
      run: ({ context, questions, attachments, taskId }, { sessionId }) =>
        this.open(
          sessionId,
          { context, questions: questions.map(questionFromToolInput), attachmentIds: attachments },
          taskId,
        ),
    });
  }

  private registerConsult(): void {
    this.registry.register({
      name: CONSULT_TOOL,
      description: `Consults or calls a person when your brief or your authority says to consult them first, or the user asks you to call them, or the user when your brief says to ask the user. Ask questions, everything you need in one form, each with its options and the one you recommend (set several when they may pick more than one, and recommend each you would pick), or with none for one they answer in words: they answer each, with an optional comment on each and a general comment, or ask you again; ask approval of a call past a Hard switch, whose answer is ${APPROVAL_OPTIONS.join(" or ")}, never "always"; or make a request, asking them to do what you can't, such as "ask a colleague to set that up": they work with their own tools and permissions, never yours, and answer in their own words. A hired Consultant answers in a Consultation: on the Task, or in their own chat when you call from a chat or from an Initiative's Thread on no Task. On a Task, if nobody who can be consulted fills that Role, the user answers in their place; from a chat, the user answers it inline in your chat. Nobody is asked twice down one chain of calls, and at most ${CALL_STEPS} people are. The call shows as a Decision card in this Thread. It returns at once; then end your turn without asking again. The answer comes as your next message.`,
      input: z.object({
        person: z
          .string()
          .optional()
          .describe(
            "Whom you consult or call, as your brief, your authority or the user names them, by their Role; none when your brief says to ask the user.",
          ),
        kind: z
          .enum(["question", "approval", "request"])
          .optional()
          .describe(
            `question, the default: a form of one or more questions, given in questions; approval of a call past a Hard switch, answered ${APPROVAL_OPTIONS.join(" or ")}; or request, asking them to do something, answered in their words. An approval and a request take question and why instead of questions.`,
          ),
        context: z.string().describe("What they need to know to answer: what you found."),
        questions: QUESTIONS_INPUT.optional().describe(
          "For a question: everything you ask, in one form, in the order they answer it.",
        ),
        question: z
          .string()
          .optional()
          .describe(
            "For an approval, the call you ask to make, such as: Install ffmpeg on the machine; for a request, what you ask them to do.",
          ),
        why: z.string().optional().describe("For an approval or a request, why you need it."),
        taskId: z
          .string()
          .optional()
          .describe(
            "In an Initiative's planning Thread, the Task the call is about, by its id, so it is on that Task as its Decisions are; leave it out for a call on no Task, answered in the person's own chat. Leave it out in a Thread on a Task, where it is on that Task.",
          ),
      }),
      run: async (input, { sessionId }) => {
        const consult = consultOf(input);
        if (typeof consult === "string") return { text: consult, isError: true };
        try {
          const consultant = await this.consultations.put(sessionId, consult, input.taskId);
          const person = input.person?.trim();
          const putTo = consultant
            ? `${consultant.name}, in a Consultation`
            : person
              ? `the user in place of ${person}`
              : "the user";
          return {
            text: `The Office put your consult to ${putTo}, as a Decision in this Thread. ${END_YOUR_TURN}`,
            isError: false,
          };
        } catch (error) {
          if (error instanceof ThreadRefused) return { text: error.message, isError: true };
          throw error;
        }
      },
    });
  }

  private registerAnswerConsultation(): void {
    this.registry.register({
      name: ANSWER_CONSULTATION_TOOL,
      description: `Gives your answer in this Consultation: it answers the Decision the person who asked is waiting on, and reaches them as their next message. Answer each of its questions, in order: choose one of its options by its number (for a choice of several, every option that applies, in options), or answer in your own words, with a comment if you like; add a general comment if you like. Or ask them again instead, answering none of the questions, saying why in the general comment. A request you answer in your own words: what you did, such as a Proposal you drafted, or why you can't. To approve a call, choose ${APPROVAL_OPTIONS.map((option, index) => `${index + 1} for "${option}"`).join(" or ")}, with no comment, or pass it on when the call isn't yours to decide: to the person your authority names, or to the user. At most ${CALL_STEPS} people are asked down one chain of calls and passes-on, then it is the user's; nobody already in it can be asked again. A question The Office put to you first, you answer in your own words, or pass on to the user.`,
      input: z.object({
        ...ANSWER_INPUT,
        passOn: z
          .object({
            person: z
              .string()
              .optional()
              .describe("Whom you pass it on to, by their Role; none to pass it on to the user."),
            why: z.string().describe("Why the call isn't yours to decide, in a sentence."),
          })
          .optional()
          .describe("To pass an approval, or The Office's question, on instead of answering it."),
      }),
      run: async ({ passOn, ...input }, { sessionId }) => {
        try {
          if (passOn) {
            const next = await this.consultations.passOn(sessionId, passOn.person, passOn.why);
            const to = next ? `${next.name}, in a Consultation of their own` : "the user";
            return { text: `You passed it on to ${to}. End your turn.`, isError: false };
          }
          const given = answerFromToolInput(input);
          if (!("kind" in given)) return { text: given.problems.join(" "), isError: true };
          await this.consultations.answer(sessionId, given);
          return { text: "Your answer reached them. End your turn.", isError: false };
        } catch (error) {
          if (error instanceof ThreadRefused) return { text: error.message, isError: true };
          throw error;
        }
      },
    });
  }

  private registerAnswerDecision(): void {
    this.registry.register({
      name: ANSWER_DECISION_TOOL,
      description:
        "Answers a Decision waiting on the user, for the user, when they asked you to in this Thread: use it only then, with the answers they gave or agreed to. Answer each of its questions, in order: choose one of its options by its number (for a choice of several, every option they picked, in options), or answer in the user's own words, with their comment if they gave one; add their general comment if they gave one. Or ask again for them, answering none of the questions, with their general comment. The card shows it as answered by you at the user's request, and the answer reaches the person who asked as their next message. read_task lists a Task's Decisions waiting on the user, with their ids, their questions and numbered options. An approval of a call stays the user's own click, a Decision put to a Consultant is theirs, and one in this Thread the user answers on its card.",
      input: z.object({
        decisionId: z.string().describe("The Decision's id, as read_task or a mention gives it."),
        ...ANSWER_INPUT,
      }),
      run: async ({ decisionId, ...input }, { sessionId }) => {
        const given = answerFromToolInput(input);
        if (!("kind" in given)) return { text: given.problems.join(" "), isError: true };
        try {
          const decision = await this.decisions.answerForUser(sessionId, decisionId, given);
          const user = userWords(decision.answer?.atUsersRequest?.user ?? null);
          const summary = decisionSummary(decision);
          const comment = given.generalComment?.trim();
          const what =
            given.kind === "asked-again"
              ? `You asked again for ${user}, answering none of the questions of the Decision "${summary}"${comment ? `: ${comment}` : ", with no comment."}`
              : `You answered the Decision "${summary}" for ${user}:\n\n${formAnswerWords(decision, given)}`;
          return {
            text: `${what}\n\nThe Office passes it on to whoever waits on it.`,
            isError: false,
          };
        } catch (error) {
          if (error instanceof ThreadRefused) return { text: error.message, isError: true };
          if (error instanceof DecisionNotFound) {
            return {
              text: `${error.message} Read the Task with read_task for the ids of its Decisions waiting on the user.`,
              isError: true,
            };
          }
          throw error;
        }
      },
    });
  }

  private async open(
    sessionId: string,
    draft: DecisionDraft,
    taskId: string | undefined,
  ): Promise<OfficeToolResult> {
    try {
      const { decision, home, initiativeThread } = await this.decisions.open(sessionId, draft, {
        taskId,
      });
      const onTask = decision.taskId;
      if (home.kind === "chat") {
        return {
          text: `The Decision is open inline in this chat, waiting on the user to answer it here. ${END_YOUR_TURN}`,
          isError: false,
        };
      }
      if (home.kind !== "initiative") {
        return {
          text: `The Decision is open in this Thread, waiting on the user. ${END_YOUR_TURN}`,
          isError: false,
        };
      }
      if (onTask === undefined) {
        return {
          text:
            initiativeThread === "planning"
              ? "The Decision is open on the Initiative, waiting on the user. Plan the Tasks that don't need its answer; end your turn once every Task left waits for an answer. Its answer comes as a message."
              : "The Decision is open on the Initiative, waiting on the user. End your turn now: their answer comes as your next message.",
          isError: false,
        };
      }
      const title = await this.work.taskTitle(onTask);
      return {
        text: `The Decision is open on "${title ?? onTask}", waiting on the user. Plan the Tasks that don't wait for it; end your turn once every Task left waits for an answer. Each answer comes as a message.`,
        isError: false,
      };
    } catch (error) {
      if (error instanceof ThreadRefused) return { text: error.message, isError: true };
      throw error;
    }
  }
}

/** The consult the tool's input asks, by its kind (a form of questions unless it says otherwise), or what's missing. */
function consultOf(input: {
  readonly person?: string | undefined;
  readonly kind?: "question" | "approval" | "request" | undefined;
  readonly context: string;
  readonly questions?: readonly QuestionInput[] | undefined;
  readonly question?: string | undefined;
  readonly why?: string | undefined;
}): Consult | string {
  const { person, context, question, why } = input;
  switch (input.kind ?? "question") {
    case "approval":
      if (question === undefined || why === undefined) {
        return "An approval names the call in question and why you need it in why.";
      }
      return { kind: "approval", person, call: question, context, why };
    case "request":
      if (question === undefined || why === undefined) {
        return "A request says what you ask them to do in question and why you need it in why.";
      }
      return { kind: "request", person, request: question, context, why };
    case "question":
      if (input.questions === undefined) {
        return "Give your questions in questions: each with its options, the one you recommend and why, or with no options for one answered in words.";
      }
      return {
        kind: "form",
        person,
        context,
        questions: input.questions.map(questionFromToolInput),
      };
  }
}

/** One question as a tool takes it, its recommended options counted from 1. */
const QUESTION_INPUT = z.object({
  question: z.string().describe("The question, as the person answering reads it."),
  options: z
    .array(z.string())
    .optional()
    .describe(
      "Two or more options, each a short line they can choose. Leave them out for a question answered in their own words.",
    ),
  several: z
    .boolean()
    .optional()
    .describe(
      "With options: true when they pick every option that applies, one or more, shown as checkboxes; left out, they pick one.",
    ),
  recommended: z
    .union([z.number().int(), z.array(z.number().int())])
    .optional()
    .describe(
      "With options: the one you recommend, by its number in the list, counting from 1; with several, every one you recommend, as a list of their numbers.",
    ),
  why: z
    .string()
    .optional()
    .describe("With options: why you recommend it, or them, in a sentence."),
});

type QuestionInput = z.infer<typeof QUESTION_INPUT>;

const QUESTIONS_INPUT = z
  .array(QUESTION_INPUT)
  .describe(
    "Everything you ask, in one form, in the order it is answered: one question or more, each with its options or none.",
  );

/**
 * A question as the tool's input gives it: a choice with options, a choice of several with options
 * and several set, an open question without options.
 */
function questionFromToolInput({
  question,
  options,
  several,
  recommended,
  why,
}: QuestionInput): DecisionQuestion {
  if (options === undefined || options.length === 0) {
    return { kind: "open", question, ...(why === undefined ? {} : { why }) };
  }
  const numbers = recommended === undefined ? [] : [recommended].flat();
  const reason = why ?? "";
  if (several) {
    return {
      kind: "choice-of-several",
      question,
      options,
      recommendation: { options: numbers.map((number) => number - 1), reason },
    };
  }
  // A list for a choice of one recommends its one number; anything else fails as no option.
  const option = numbers.length === 1 ? numbers[0]! - 1 : -1;
  return { kind: "choice", question, options, recommendation: { option, reason } };
}

/** How answer_consultation and answer_decision take an answer: one per question, or ask again. */
const ANSWER_INPUT = {
  answers: z
    .array(
      z.object({
        option: z
          .number()
          .int()
          .optional()
          .describe("The option chosen, by its number in the question's list, counting from 1."),
        options: z
          .array(z.number().int())
          .optional()
          .describe(
            "For a choice of several instead: every option chosen, one or more, by their numbers in the question's list, counting from 1.",
          ),
        answer: z
          .string()
          .optional()
          .describe(
            "The answer in words instead: to a question with no options, or when none of its options fits.",
          ),
        comment: z.string().optional().describe("A comment on this answer, if any."),
      }),
    )
    .optional()
    .describe(
      "One answer per question, in the Decision's order, each an option, options or words.",
    ),
  generalComment: z
    .string()
    .optional()
    .describe("A comment on the whole Decision, if any; with askAgain, why it is asked again."),
  askAgain: z
    .boolean()
    .optional()
    .describe(
      "True to answer none of the questions and have whoever asked ask again, saying why in generalComment.",
    ),
};

type AnswerInput = z.infer<z.ZodObject<typeof ANSWER_INPUT>>;

/**
 * The answer the tool's input gives, its options counted from 1 turned into indexes, or what's
 * wrong with it in words naming the question: each answer an option or words, never both or neither,
 * and either answers or Ask again.
 */
function answerFromToolInput({
  answers,
  generalComment,
  askAgain,
}: AnswerInput): DecisionAnswer | { readonly problems: readonly string[] } {
  if (askAgain) {
    if (answers !== undefined && answers.length > 0) {
      return { problems: ["Either answer the questions or ask again, not both."] };
    }
    return { kind: "asked-again", ...(generalComment === undefined ? {} : { generalComment }) };
  }
  if (answers === undefined || answers.length === 0) {
    return { problems: ["Answer each question in answers, in order, or ask again with askAgain."] };
  }
  const problems = answers.flatMap(({ option, options, answer }, index) => {
    const named = answers.length > 1 ? `Question ${index + 1}: ` : "";
    const given = [option, options, answer].filter((part) => part !== undefined).length;
    if (given > 1) return [`${named}Choose an option (or options) or answer in words, not both.`];
    if (given === 0) return [`${named}Choose an option (or options) or answer in words.`];
    return [];
  });
  if (problems.length > 0) return { problems };
  return {
    kind: "submitted",
    answers: answers.map(({ option, options, answer, comment }): QuestionAnswer => {
      const commented = comment === undefined ? {} : { comment };
      if (option !== undefined) return { kind: "option", option: option - 1, ...commented };
      if (options !== undefined) {
        return { kind: "options", options: options.map((number) => number - 1), ...commented };
      }
      return { kind: "words", text: answer ?? "", ...commented };
    }),
    ...(generalComment === undefined ? {} : { generalComment }),
  };
}

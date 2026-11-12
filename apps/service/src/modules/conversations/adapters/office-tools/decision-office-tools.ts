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
import { answerWords, type DecisionAnswer, type DecisionDraft } from "../../domain/decision.js";
import { DecisionNotFound } from "../../domain/decision-not-found.js";
import { ThreadRefused } from "../../domain/thread-refused.js";

const END_YOUR_TURN =
  "End your turn now: their answer, or a follow-up question, comes as your next message.";

/**
 * The Office tools an Agent asks with, in a Thread on a Task (spec §2.4, §6): it opens a Decision,
 * or consults a person, whose Consultation answers a Decision put to them; a Consultant gives their
 * answer with the third. Asking returns at once: the Agent ends its turn, and the answer comes as
 * its next message (spec §9). The Planner opens Decisions in an Initiative's planning Thread too,
 * each on one of its Tasks, and plans on while they wait. A person the user talks to answers a
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
        "Opens a Decision in this Thread when a choice is the user's to make: they see your question as a card with its options and the one you recommend, and answer with an option or in their own words, or ask you a follow-up first. It returns at once; then end your turn without asking the question again. Their answer comes as your next message. In an Initiative's planning Thread, name the Task it is on with taskId: several can be open there, one per Task, and you plan on meanwhile.",
      input: z.object({
        question: z.string().describe("One question, as the user reads it."),
        context: z
          .string()
          .describe("What the user needs to know to decide: what you found, in a few lines."),
        options: z
          .array(z.string())
          .describe("Two or more options, each a short line the user can choose."),
        recommended: z
          .number()
          .int()
          .describe("The option you recommend, by its number in the list, counting from 1."),
        why: z.string().describe("Why you recommend it, in a sentence."),
        attachments: z
          .array(z.string())
          .optional()
          .describe(
            "The Task's Attachments this Decision is about, of any kind, by their ids, for the user to see on its card. Leave it out when it is about none.",
          ),
        taskId: z
          .string()
          .optional()
          .describe(
            "In an Initiative's planning Thread, the Task the Decision is on: one of the Initiative's Tasks, by its id. Leave it out in a Thread on a Task, where it is on that Task.",
          ),
      }),
      run: ({ question, context, options, recommended, why, attachments, taskId }, { sessionId }) =>
        this.open(
          sessionId,
          {
            question,
            context,
            options,
            recommendation: { option: recommended - 1, reason: why },
            attachmentIds: attachments,
          },
          taskId,
        ),
    });
  }

  private registerConsult(): void {
    this.registry.register({
      name: CONSULT_TOOL,
      description: `Consults or calls a person when your brief or your authority says to consult them first, or the user asks you to call them, or the user when your brief says to ask the user. Ask a question; ask approval of a call past a Hard switch, whose answer is ${APPROVAL_OPTIONS.join(" or ")}, never "always"; or make a request, asking them to do what you can't, such as "ask Devops to set that up": they work with their own tools and permissions, never yours, and answer in their own words. A hired Consultant answers in a Consultation: on the Task, or in their own chat when you call from a chat. On a Task, if nobody who can be consulted fills that Role, the user answers in their place; from a chat, ask the user in your answer instead. Nobody is asked twice down one chain of calls, and at most ${CALL_STEPS} people are. The call shows as a Decision card in this Thread. It returns at once; then end your turn without asking again. The answer comes as your next message.`,
      input: z.object({
        person: z
          .string()
          .optional()
          .describe(
            "Whom you consult or call, as your brief, your authority or the user names them, such as Devops; none when your brief says to ask the user.",
          ),
        kind: z
          .enum(["question", "approval", "request"])
          .optional()
          .describe(
            `question, the default, with options; approval of a call past a Hard switch, answered ${APPROVAL_OPTIONS.join(" or ")}; or request, asking them to do something, answered in their words.`,
          ),
        question: z
          .string()
          .describe(
            "Your question; for an approval, the call you ask to make, such as: Install ffmpeg on the machine; for a request, what you ask them to do.",
          ),
        context: z.string().describe("What they need to know to answer: what you found."),
        options: z
          .array(z.string())
          .optional()
          .describe(
            "For a question: two or more options, each a short line. None for an approval or a request.",
          ),
        recommended: z
          .number()
          .int()
          .optional()
          .describe("For a question: the option you recommend, by its number, counting from 1."),
        why: z
          .string()
          .describe(
            "For a question, why you recommend it; for an approval or a request, why you need it.",
          ),
      }),
      run: async (input, { sessionId }) => {
        const consult = consultOf(input);
        try {
          const consultant = await this.consultations.put(sessionId, consult);
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
      description: `Gives your answer in this Consultation: it answers the Decision the person who asked is waiting on, and reaches them as their next message. For a question, choose one of their options by its number, or answer in your own words. A request you answer in your own words: what you did, such as a Proposal you drafted, or why you can't. To approve a call, choose ${APPROVAL_OPTIONS.map((option, index) => `${index + 1} for "${option}"`).join(" or ")}, or pass it on when the call isn't yours to decide: to the person your authority names, or to the user. At most ${CALL_STEPS} people are asked down one chain of calls and passes-on, then it is the user's; nobody already in it can be asked again. A question The Office put to you first, you answer in your own words, or pass on to the user.`,
      input: z.object({
        option: z
          .number()
          .int()
          .optional()
          .describe("The option you choose, by its number in their list, counting from 1."),
        answer: z
          .string()
          .optional()
          .describe("Your answer in your own words, when no option fits."),
        passOn: z
          .object({
            person: z
              .string()
              .optional()
              .describe("Whom you pass it on to, such as CTO; none to pass it on to the user."),
            why: z.string().describe("Why the call isn't yours to decide, in a sentence."),
          })
          .optional()
          .describe("To pass an approval, or The Office's question, on instead of answering it."),
      }),
      run: async ({ option, answer, passOn }, { sessionId }) => {
        try {
          if (passOn) {
            const next = await this.consultations.passOn(sessionId, passOn.person, passOn.why);
            const to = next ? `${next.name}, in a Consultation of their own` : "the user";
            return { text: `You passed it on to ${to}. End your turn.`, isError: false };
          }
          await this.consultations.answer(
            sessionId,
            option !== undefined
              ? { kind: "option", option: option - 1 }
              : { kind: "free-answer", text: answer ?? "" },
          );
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
        "Answers a Decision waiting on the user, for the user, when they asked you to in this Thread: use it only then, with the answer they gave or agreed to. Choose one of its options by its number, or answer in your own words. The card shows it as answered by you at the user's request, and the answer reaches the person who asked as their next message. read_task lists a Task's Decisions waiting on the user, with their ids and numbered options. An approval of a call stays the user's own click, a Decision put to a Consultant is theirs, and one in this Thread the user answers on its card.",
      input: z.object({
        decisionId: z.string().describe("The Decision's id, as read_task or a mention gives it."),
        option: z
          .number()
          .int()
          .optional()
          .describe("The option the user chose, by its number in the list, counting from 1."),
        answer: z
          .string()
          .optional()
          .describe("The answer in the user's own words, when no option fits."),
      }),
      run: async ({ decisionId, option, answer }, { sessionId }) => {
        const given: DecisionAnswer =
          option !== undefined
            ? { kind: "option", option: option - 1 }
            : { kind: "free-answer", text: answer ?? "" };
        try {
          const decision = await this.decisions.answerForUser(sessionId, decisionId, given);
          return {
            text: `You answered the Decision "${decision.question}" for the user: "${answerWords(decision, given)}". The Office passes it on to whoever waits on it.`,
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
      const { decision, home } = await this.decisions.open(sessionId, draft, { taskId });
      const onTask = decision.taskId;
      if (home.kind !== "initiative" || onTask === undefined) {
        return {
          text: `The Decision is open in this Thread, waiting on the user. ${END_YOUR_TURN}`,
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

/** The consult the tool's input asks, by its kind: a question unless it says otherwise. */
function consultOf(input: {
  readonly person?: string | undefined;
  readonly kind?: Consult["kind"] | undefined;
  readonly question: string;
  readonly context: string;
  readonly options?: readonly string[] | undefined;
  readonly recommended?: number | undefined;
  readonly why: string;
}): Consult {
  const { person, question, context, why } = input;
  switch (input.kind ?? "question") {
    case "approval":
      return { kind: "approval", person, call: question, context, why };
    case "request":
      return { kind: "request", person, request: question, context, why };
    case "question":
      return {
        kind: "question",
        person,
        question,
        context,
        options: input.options ?? [],
        recommended: (input.recommended ?? 0) - 1,
        why,
      };
  }
}

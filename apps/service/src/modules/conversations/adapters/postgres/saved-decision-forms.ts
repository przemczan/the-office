import {
  questionAnswerWords,
  type DecisionAnswer,
  type DecisionQuestion,
  type QuestionAnswer,
} from "../../domain/decision.js";
import type { SavedFormAnswer, SavedQuestion, SavedQuestionAnswer } from "./threads.schema.js";

/** The form's questions as kept, a choice of several as a choice the release before reads. */
export function toSavedQuestions(questions: readonly DecisionQuestion[]): SavedQuestion[] {
  return questions.map((question) => {
    if (question.kind !== "choice-of-several") return question;
    const { question: asked, options, recommendation } = question;
    return {
      kind: "choice",
      question: asked,
      options,
      recommendation: { option: recommendation.options[0] ?? 0, reason: recommendation.reason },
      several: { recommended: recommendation.options },
    };
  });
}

export function fromSavedQuestions(saved: readonly SavedQuestion[]): DecisionQuestion[] {
  return saved.map((question) => {
    if (question.kind !== "choice" || !("several" in question)) return question;
    const { question: asked, options, recommendation, several } = question;
    return {
      kind: "choice-of-several",
      question: asked,
      options,
      recommendation: { options: several.recommended, reason: recommendation.reason },
    };
  });
}

/** The form's answer as kept, its questions naming the options a choice of several picked. */
export function toSavedFormAnswer(
  answer: DecisionAnswer,
  questions: readonly DecisionQuestion[],
): SavedFormAnswer {
  if (answer.kind === "dismissed") return { ...answer, kind: "asked-again", dismissed: true };
  if (answer.kind === "asked-again") return answer;
  return {
    ...answer,
    answers: answer.answers.map((given, index) => toSavedQuestionAnswer(given, questions[index])),
  };
}

function toSavedQuestionAnswer(
  given: QuestionAnswer,
  question: DecisionQuestion | undefined,
): SavedQuestionAnswer {
  if (given.kind !== "options") return given;
  const { options, comment } = given;
  // A Decision not at hand names its options by their numbers, counting from 1.
  const text =
    question === undefined
      ? options.map((option) => option + 1).join("; ")
      : questionAnswerWords(question, given);
  return { kind: "words", text, ...(comment === undefined ? {} : { comment }), options };
}

export function fromSavedFormAnswer(saved: SavedFormAnswer): DecisionAnswer {
  if ("dismissed" in saved) {
    const { dismissed: _dismissed, ...answer } = saved;
    return { ...answer, kind: "dismissed" };
  }
  if (saved.kind === "asked-again") return saved;
  return { ...saved, answers: saved.answers.map(fromSavedQuestionAnswer) };
}

function fromSavedQuestionAnswer(saved: SavedQuestionAnswer): QuestionAnswer {
  if (saved.kind !== "words" || !("options" in saved)) return saved;
  const { options, comment } = saved;
  return { kind: "options", options, ...(comment === undefined ? {} : { comment }) };
}

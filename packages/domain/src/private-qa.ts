import { integer, object, text, timestamp } from "./validation.js";

export const PRIVATE_QA_ANSWER_KINDS = [
  "sourced",
  "speculative",
  "unknown",
  "permission_denied",
] as const;
export type PrivateQAAnswerKind = (typeof PRIVATE_QA_ANSWER_KINDS)[number];

/**
 * A recipient-only question and answer. These records never enter public
 * events, analytics, or the default archive.
 */
export interface PrivateQA {
  readonly id: string;
  readonly preparationSessionId: string;
  readonly question: string;
  readonly answer: string;
  readonly asOfRevision: number;
  readonly answerKind: PrivateQAAnswerKind;
  readonly createdAt: string;
}

export interface CreatePrivateQAInput {
  readonly id: string;
  readonly preparationSessionId: string;
  readonly question: string;
  readonly answer: string;
  readonly asOfRevision: number;
  readonly answerKind: PrivateQAAnswerKind;
  readonly createdAt: string;
}

export function parsePrivateQA(value: unknown): PrivateQA {
  const input = object(value, "PrivateQA");
  const answerKind = text(input.answerKind, "PrivateQA.answerKind") as PrivateQAAnswerKind;
  if (!PRIVATE_QA_ANSWER_KINDS.includes(answerKind)) {
    throw new TypeError(`Unsupported PrivateQA.answerKind: ${answerKind}`);
  }
  return Object.freeze({
    id: text(input.id, "PrivateQA.id"),
    preparationSessionId: text(input.preparationSessionId, "PrivateQA.preparationSessionId"),
    question: text(input.question, "PrivateQA.question"),
    answer: text(input.answer, "PrivateQA.answer"),
    asOfRevision: integer(input.asOfRevision, "PrivateQA.asOfRevision"),
    answerKind,
    createdAt: timestamp(input.createdAt, "PrivateQA.createdAt"),
  });
}

export function createPrivateQA(input: CreatePrivateQAInput): PrivateQA {
  return parsePrivateQA(input);
}

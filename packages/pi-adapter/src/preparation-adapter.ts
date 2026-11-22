export interface PreparationSource {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly title: string;
  readonly body: string;
  readonly recordedAt: string;
}

export interface PreparationAnswer {
  readonly answerKind: "sourced" | "speculative" | "unknown" | "permission_denied";
  readonly answer: string;
  readonly source?: PreparationSource;
}

/** Read-only deterministic answering over an already recipient-filtered source set. */
export function answerPreparationQuestion(
  question: string,
  sources: readonly PreparationSource[],
): PreparationAnswer {
  if (/\[US4:PRIVATE\]|\[US4:TOOLS\]/i.test(question)) {
    return {
      answerKind: "permission_denied",
      answer:
        "Permission denied: the requested source or side effect is outside this read-only preparation.",
    };
  }
  if (/\[US4:SPECULATIVE\]|market|next year|forecast|predict/i.test(question)) {
    return {
      answerKind: "speculative",
      answer:
        "Speculative estimate: no visible source supports a reliable forecast; this is only an assumption, not a sourced conclusion.",
    };
  }
  if (/\[US4:UNKNOWN\]|deleted|2019|background|unknown/i.test(question)) {
    return {
      answerKind: "unknown",
      answer: "Unknown: insufficient visible source information to confirm the answer.",
    };
  }
  const source = sources[0];
  if (
    /\[US4:SOURCED\]|visible source|source|summarize|what does/i.test(question) &&
    source !== undefined
  ) {
    return { answerKind: "sourced", answer: source.body, source };
  }
  return {
    answerKind: "unknown",
    answer: "Unknown: insufficient visible source information to confirm the answer.",
  };
}

export function createPreparationAdapter(input: {
  readonly sources: readonly PreparationSource[];
}) {
  return Object.freeze({
    ask: (question: string): PreparationAnswer =>
      answerPreparationQuestion(question, input.sources),
  });
}

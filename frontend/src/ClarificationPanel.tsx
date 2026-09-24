import { useState } from "react";
import { useT } from "./i18n";

type Question = {
  id: string;
  text: string;
  feature_id?: string;
  dimension_refs?: string[];
  options: string[];
  required?: boolean;
  reason?: string;
  impact?: string;
  answer_type?: "text" | "number" | "choice";
  unit?: string;
  default_value?: string;
};

export default function ClarificationPanel({
  questions,
  onContinue,
  disabled,
}: {
  questions: Question[];
  onContinue: (answers: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!questions.length) return <p className="muted">{t("clarification.empty")}</p>;

  const update = (id: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    setErrors((prev) => (prev[id] ? { ...prev, [id]: "" } : prev));
  };
  const useDefault = (question: Question) => update(question.id, question.default_value ?? "");
  const finalAnswer = (question: Question) => (answers[question.id] ?? "").trim();
  const answeredCount = questions.filter((question) => finalAnswer(question)).length;
  const missingRequired = questions.filter((question) => question.required !== false && !finalAnswer(question)).length;
  const complete = missingRequired === 0;
  const hasErrors = Object.values(errors).some(Boolean);

  return (
    <div className="clarification-list">
      <div className="clarification-list-head">
        <strong>{t("clarification.needs_answer")}</strong>
        <span>{t("clarification.progress", { answered: answeredCount, total: questions.length })}</span>
        {questions.some((question) => question.default_value) && (
          <button
            type="button"
            className="clarification-defaults"
            disabled={disabled}
            onClick={() => {
              const next: Record<string, string> = {};
              for (const question of questions) {
                if (question.default_value) next[question.id] = question.default_value;
              }
              setAnswers(next);
              setErrors({});
            }}
          >
            {t("clarification.use_default")}
          </button>
        )}
      </div>
      {questions.map((question) => {
        const invalidNumber = question.answer_type === "number" && Boolean(errors[question.id]);
        return (
          <article className="clarification-card ask-question" key={question.id}>
            <div className="ask-question-head">
              <span className="ask-question-text">{question.text}</span>
              <span className="ask-required-tag">
                {question.required === false ? t("approval.question.optional") : t("approval.question.required")}
              </span>
            </div>
            {question.feature_id && <p><b>{t("clarification.feature")}</b>{question.feature_id}</p>}
            {question.dimension_refs?.length ? <p><b>{t("clarification.dimensions")}</b>{question.dimension_refs.join(t("clarification.dim_sep"))}</p> : null}
            {question.reason && <p><b>{t("clarification.reason")}</b>{question.reason}</p>}
            {question.impact && <p><b>{t("clarification.impact")}</b>{question.impact}</p>}
            {question.default_value ? (
              <div className="clarification-default-row">
                <span>{t("clarification.default", { value: question.default_value })}</span>
                <button type="button" disabled={disabled} onClick={() => useDefault(question)}>
                  {t("clarification.use_default")}
                </button>
              </div>
            ) : null}
            {question.answer_type === "choice" && question.options.length ? (
              <select value={answers[question.id] || ""} onChange={(event) => update(question.id, event.target.value)}>
                <option value="">{t("clarification.select")}</option>
                {question.options.map((option) => <option value={option} key={option}>{option}</option>)}
              </select>
            ) : (
              <div className="answer-input">
                <input
                  type={question.answer_type === "number" ? "number" : "text"}
                  step={question.answer_type === "number" ? "any" : undefined}
                  value={answers[question.id] || ""}
                  aria-invalid={invalidNumber}
                  onChange={(event) => update(question.id, event.target.value)}
                  onBlur={() => {
                    if (question.answer_type !== "number") return;
                    const value = (answers[question.id] ?? question.default_value ?? "").trim();
                    const invalid = Boolean(value) && !Number.isFinite(Number(value));
                    setErrors((prev) => ({ ...prev, [question.id]: invalid ? "clarification.invalid_number" : "" }));
                  }}
                  placeholder={question.default_value ? t("clarification.default", { value: question.default_value }) : t("clarification.placeholder")}
                />
                {question.unit && <span>{question.unit}</span>}
              </div>
            )}
            {invalidNumber && <small className="approval-edit-error">{t("clarification.invalid_number")}</small>}
          </article>
        );
      })}
      {missingRequired > 0 && (
        <p className="decision-hint" aria-live="polite">
          {t("clarification.missing_required", { count: missingRequired })}
        </p>
      )}
      <button
        className="primary"
        disabled={disabled || !complete || hasErrors}
        onClick={() => onContinue(questions.map((question) => finalAnswer(question)).filter(Boolean).join("; "))}
      >
        {t("clarification.confirm")}
      </button>
    </div>
  );
}

import { useState } from "react";
import type { Approval, AskQuestion, PlanBomItem, PlanStep } from "./api";
import { useT } from "./i18n";

type Props = {
  approvals: Approval[];
  busy: boolean;
  onResolve: (approval: Approval, action: "approve" | "reject" | "edit", argsOverride?: Record<string, unknown>) => void;
};

type DraftValue =
  | { ok: true; value: unknown }
  | { ok: false };

function valueKind(value: unknown): "number" | "boolean" | "json" | "text" {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value !== null && (Array.isArray(value) || typeof value === "object")) return "json";
  return "text";
}

function draftText(value: unknown): string {
  if (valueKind(value) === "json") return JSON.stringify(value, null, 2) ?? "";
  if (value === null || value === undefined) return "";
  return String(value);
}

function parseDraft(original: unknown, raw: string): DraftValue {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: undefined };
  const kind = valueKind(original);
  if (kind === "number") {
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false };
  }
  if (kind === "boolean") {
    if (trimmed === "true") return { ok: true, value: true };
    if (trimmed === "false") return { ok: true, value: false };
    return { ok: false };
  }
  if (kind === "json") {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(original) !== Array.isArray(parsed)) return { ok: false };
      if (!Array.isArray(original) && (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))) return { ok: false };
      return { ok: true, value: parsed };
    } catch {
      return { ok: false };
    }
  }
  return { ok: true, value: trimmed };
}

function draftErrorKey(kind: "number" | "boolean" | "json" | "text"): string | null {
  if (kind === "number") return "approval.args.invalid_number";
  if (kind === "boolean") return "approval.args.invalid_boolean";
  if (kind === "json") return "approval.args.invalid_json";
  return null;
}

/**
 * 人机协作审批卡：破坏性操作/破坏性修复走通用 approve/edit/reject；
 * ask_user 渲染结构化问题卡片（单选/多选/自由文本 + 自动"其他"）。
 */
export default function ApprovalPanel({ approvals, busy, onResolve }: Props) {
  const t = useT();
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [draftErrors, setDraftErrors] = useState<Record<string, Record<string, string>>>({});

  if (approvals.length === 0) {
    return null;
  }

  const clearDraft = (approvalId: string) => {
    setDrafts((s) => {
      const next = { ...s };
      delete next[approvalId];
      return next;
    });
    setDraftErrors((s) => {
      const next = { ...s };
      delete next[approvalId];
      return next;
    });
  };

  const updateDraft = (approvalId: string, key: string, value: string) => {
    setDrafts((s) => ({ ...s, [approvalId]: { ...(s[approvalId] ?? {}), [key]: value } }));
    setDraftErrors((s) => {
      const current = s[approvalId] ?? {};
      if (!current[key]) return s;
      return { ...s, [approvalId]: { ...current, [key]: "" } };
    });
  };

  const validateDraft = (approval: Approval, key: string): string | null => {
    const original = (approval.args ?? {})[key];
    const raw = drafts[approval.approval_id]?.[key] ?? "";
    const kind = valueKind(original);
    const parsed = parseDraft(original, raw);
    return parsed.ok ? null : (draftErrorKey(kind) ?? "");
  };

  const startEdit = (approval: Approval) => {
    const draft: Record<string, string> = {};
    for (const [key, value] of Object.entries(approval.args ?? {})) {
      draft[key] = draftText(value);
    }
    setDrafts((s) => ({ ...s, [approval.approval_id]: draft }));
    setDraftErrors((s) => ({ ...s, [approval.approval_id]: {} }));
  };

  return (
    <div className="approval-list">
      {approvals.map((approval) => {
        if (approval.kind === "ask_user") {
          return <AskUserCard key={approval.approval_id} approval={approval} busy={busy} onResolve={onResolve} />;
        }
        if (approval.kind === "plan_review") {
          return <PlanReviewCard key={approval.approval_id} approval={approval} busy={busy} onResolve={onResolve} />;
        }
        const kindLabel =
          approval.kind === "destructive_fix"
            ? t("approval.kind.fix")
            : t("approval.kind.destructive");
        const draft = drafts[approval.approval_id];
        const errors = draftErrors[approval.approval_id] ?? {};
        const isEditing = Boolean(draft);
        const argText = JSON.stringify(approval.args ?? {}, null, 0);
        const hasErrors = Object.values(errors).some(Boolean);
        return (
          <div className="approval-card" key={approval.approval_id}>
            <div className="approval-head">
              <span className="approval-kind">{kindLabel}</span>
              <span className="approval-op">{approval.op}</span>
            </div>
            <div className="approval-message">{approval.message}</div>
            <details className="approval-args">
              <summary>{t("approval.arguments")}</summary>
              <pre>{argText}</pre>
            </details>
            {isEditing && draft ? (
              <div className="approval-edit">
                {Object.entries(draft).map(([key, value]) => {
                  const original = (approval.args ?? {})[key];
                  const kind = valueKind(original);
                  const error = errors[key];
                  return (
                    <label className={`approval-edit-field kind-${kind}${error ? " has-error" : ""}`} key={key}>
                      <span>{key}</span>
                      {kind === "json" ? (
                        <textarea
                          rows={Math.min(6, Math.max(2, value.split("\n").length))}
                          value={value}
                          aria-invalid={Boolean(error)}
                          onChange={(e) => updateDraft(approval.approval_id, key, e.target.value)}
                          onBlur={() => {
                            const message = validateDraft(approval, key);
                            setDraftErrors((s) => ({ ...s, [approval.approval_id]: { ...(s[approval.approval_id] ?? {}), [key]: message ?? "" } }));
                          }}
                        />
                      ) : kind === "boolean" ? (
                        <select
                          value={value}
                          aria-invalid={Boolean(error)}
                          onChange={(e) => updateDraft(approval.approval_id, key, e.target.value)}
                          onBlur={() => {
                            const message = validateDraft(approval, key);
                            setDraftErrors((s) => ({ ...s, [approval.approval_id]: { ...(s[approval.approval_id] ?? {}), [key]: message ?? "" } }));
                          }}
                        >
                          <option value="">—</option>
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : (
                        <input
                          type={kind === "number" ? "number" : "text"}
                          step={kind === "number" ? "any" : undefined}
                          value={value}
                          aria-invalid={Boolean(error)}
                          onChange={(e) => updateDraft(approval.approval_id, key, e.target.value)}
                          onBlur={() => {
                            const message = validateDraft(approval, key);
                            setDraftErrors((s) => ({ ...s, [approval.approval_id]: { ...(s[approval.approval_id] ?? {}), [key]: message ?? "" } }));
                          }}
                        />
                      )}
                      {error ? <small className="approval-edit-error">{t(error)}</small> : null}
                    </label>
                  );
                })}
                <div className="approval-edit-actions">
                  <button
                    type="button"
                    disabled={busy || hasErrors}
                    onClick={() => {
                      const nextErrors: Record<string, string> = {};
                      const override: Record<string, unknown> = {};
                      for (const [key, value] of Object.entries(draft)) {
                        const original = (approval.args ?? {})[key];
                        const parsed = parseDraft(original, value);
                        if (!parsed.ok) {
                          nextErrors[key] = draftErrorKey(valueKind(original)) ?? "";
                          continue;
                        }
                        override[key] = parsed.value;
                      }
                      const invalidCount = Object.keys(nextErrors).length;
                      if (invalidCount) {
                        setDraftErrors((s) => ({ ...s, [approval.approval_id]: nextErrors }));
                        return;
                      }
                      onResolve(approval, "edit", override);
                      clearDraft(approval.approval_id);
                    }}
                  >
                    {t("approval.confirm_edit")}
                  </button>
                  <button type="button" disabled={busy} onClick={() => startEdit(approval)}>
                    {t("approval.args.restore_original")}
                  </button>
                  <button type="button" disabled={busy} onClick={() => clearDraft(approval.approval_id)}>
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="approval-actions">
                <button type="button" className="approval-approve" disabled={busy} onClick={() => onResolve(approval, "approve")}>
                  {t("approval.approve")}
                </button>
                <button type="button" className="approval-edit-toggle" disabled={busy} onClick={() => startEdit(approval)}>
                  {t("approval.edit")}
                </button>
                <button type="button" className="approval-reject" disabled={busy} onClick={() => onResolve(approval, "reject")}>
                  {t("approval.reject")}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

type Answers = Record<string, string | string[]>;

function normalizeQuestions(approval: Approval, t: (k: string) => string): AskQuestion[] {
  const raw = (approval.options?.questions ?? approval.args?.questions) as AskQuestion[] | undefined;
  if (Array.isArray(raw) && raw.length) {
    return raw;
  }
  const legacy = String(approval.message || "");
  return [{ id: "q1", question: legacy || t("approval.question.fallback"), type: "text", allowFreeText: true, required: true }];
}

function isAnswered(value: string | string[] | undefined): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value && String(value).trim());
}

function AskUserCard({
  approval,
  busy,
  onResolve,
}: {
  approval: Approval;
  busy: boolean;
  onResolve: Props["onResolve"];
}) {
  const t = useT();
  const questions = normalizeQuestions(approval, t);
  const [answers, setAnswers] = useState<Answers>({});
  const [free, setFree] = useState<Record<string, string>>({});

  const setSingle = (id: string, label: string) => setAnswers((a) => ({ ...a, [id]: label }));
  const toggleMulti = (id: string, label: string) =>
    setAnswers((a) => {
      const current = Array.isArray(a[id]) ? (a[id] as string[]) : [];
      const next = current.includes(label) ? current.filter((v) => v !== label) : [...current, label];
      return { ...a, [id]: next };
    });

  const finalAnswers = (): Answers => {
    const out: Answers = {};
    for (const q of questions) {
      const freeText = (free[q.id] || "").trim();
      const base = answers[q.id];
      if (q.type === "multi") {
        const list = Array.isArray(base) ? [...base] : [];
        if (freeText) list.push(freeText);
        out[q.id] = list;
      } else if (freeText) {
        out[q.id] = freeText;
      } else if (base != null) {
        out[q.id] = base;
      }
    }
    return out;
  };

  const final = finalAnswers();
  const answeredCount = questions.filter((q) => isAnswered(final[q.id])).length;
  const missingRequired = questions.filter((q) => q.required !== false && !isAnswered(final[q.id])).length;
  const allRequiredAnswered = missingRequired === 0;

  return (
    <div className="approval-card ask-card decision-card">
      <div className="approval-head decision-head">
        <span className="approval-kind">{t("approval.kind.ask")}</span>
        <strong className="decision-title">{t("approval.question.needs_answer")}</strong>
        <span className="decision-progress">{t("approval.question.progress", { answered: answeredCount, total: questions.length })}</span>
      </div>
      {questions.map((q) => {
        const allowFree = q.allowFreeText !== false;
        return (
          <div className="ask-question" key={q.id}>
            <div className="ask-question-head">
              {q.header && <span className="ask-chip">{q.header}</span>}
              <span className="ask-question-text">{q.question}</span>
              <span className="ask-required-tag">{q.required === false ? t("approval.question.optional") : t("approval.question.required")}</span>
            </div>
            {q.type === "text" ? (
              <textarea
                className="ask-text"
                rows={2}
                value={String(answers[q.id] ?? "")}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              />
            ) : (
              <div className={`ask-options${q.type === "single" ? " ask-options-single" : ""}`} role={q.type === "single" ? "radiogroup" : "group"} aria-label={q.question}>
                {(q.options || []).map((opt) => {
                  const checked =
                    q.type === "multi"
                      ? Array.isArray(answers[q.id]) && (answers[q.id] as string[]).includes(opt.label)
                      : answers[q.id] === opt.label;
                  return (
                    <label className={`ask-option${checked ? " checked" : ""}`} key={opt.label}>
                      <input
                        type={q.type === "multi" ? "checkbox" : "radio"}
                        name={q.id}
                        checked={checked}
                        onChange={() => (q.type === "multi" ? toggleMulti(q.id, opt.label) : setSingle(q.id, opt.label))}
                      />
                      <span className="ask-option-label">
                        <span className="ask-option-title">{opt.label}</span>
                        {opt.description && <em className="ask-option-desc">{opt.description}</em>}
                      </span>
                    </label>
                  );
                })}
                {allowFree && (
                  <label className="ask-option ask-other">
                    <span className="ask-option-label">{t("approval.question.other")}</span>
                    <input
                      type="text"
                      className="ask-other-input"
                      aria-label={t("approval.question.other")}
                      value={free[q.id] ?? ""}
                      onChange={(e) => setFree((f) => ({ ...f, [q.id]: e.target.value }))}
                    />
                  </label>
                )}
              </div>
            )}
          </div>
        );
      })}
      {missingRequired > 0 && (
        <p className="decision-hint" aria-live="polite">
          {t("approval.question.missing_required", { count: missingRequired })}
        </p>
      )}
      <div className="approval-actions">
        <button
          type="button"
          className="approval-approve"
          disabled={busy || !allRequiredAnswered}
          onClick={() => onResolve(approval, "edit", { answers: finalAnswers() })}
        >
          {t("approval.question.submit")}
        </button>
        <button type="button" className="approval-reject" disabled={busy} onClick={() => onResolve(approval, "reject")}>
          {t("approval.question.skip")}
        </button>
      </div>
    </div>
  );
}

function PlanReviewCard({
  approval,
  busy,
  onResolve,
}: {
  approval: Approval;
  busy: boolean;
  onResolve: Props["onResolve"];
}) {
  const t = useT();
  const [feedback, setFeedback] = useState("");
  const plan = (approval.options?.plan ?? { steps: [] }) as { summary?: string; steps?: PlanStep[]; bom?: PlanBomItem[] };
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const bom = Array.isArray(plan.bom) ? plan.bom : [];
  // 按零件分组展示步骤（保留原顺序；无 part 归入"通用"组）
  const groups: { part: string; steps: PlanStep[] }[] = [];
  for (const step of steps) {
    const key = step.part || "";
    let group = groups.find((g) => g.part === key);
    if (!group) {
      group = { part: key, steps: [] };
      groups.push(group);
    }
    group.steps.push(step);
  }
  return (
    <div className="approval-card plan-card-review">
      <div className="approval-head">
        <span className="approval-kind">{t("approval.kind.plan")}</span>
      </div>
      {plan.summary && <div className="approval-message">{plan.summary}</div>}
      {bom.length > 0 && (
        <div className="plan-bom" data-testid="plan-bom">
          <div className="plan-bom-title">{t("plan.bom.title")}</div>
          <ul className="plan-bom-list">
            {bom.map((item) => (
              <li key={item.id || item.part} className="plan-bom-item">
                <span className="plan-bom-part">{item.part}</span>
                {item.quantity && item.quantity > 1 ? <span className="plan-bom-qty">×{item.quantity}</span> : null}
                {item.role ? <span className="plan-bom-role">{item.role}</span> : null}
                {item.key_params && Object.keys(item.key_params).length > 0 ? (
                  <code className="plan-bom-params">
                    {Object.entries(item.key_params).map(([k, v]) => `${k}=${v}`).join(" ")}
                  </code>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ol className="plan-steps">
        {groups.map((group) => (
          <li key={group.part || "*"} className="plan-step-group">
            {group.part ? <div className="plan-step-part-title">{group.part}</div> : null}
            <ol className="plan-steps plan-steps-sub">
              {group.steps.map((step) => (
                <li key={step.id} className="plan-step pending">
                  <span className="plan-step-mark" aria-hidden="true">○</span>
                  <span className="plan-step-title">{step.title}</span>
                  {step.op && <code className="plan-step-op">{step.op}</code>}
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
      <textarea
        className="ask-text"
        rows={2}
        placeholder={t("approval.plan.feedback_placeholder")}
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
      />
      <div className="approval-actions">
        <button type="button" className="approval-approve" disabled={busy} onClick={() => onResolve(approval, "approve")}>
          {t("approval.approve")}
        </button>
        <button
          type="button"
          className="approval-reject"
          disabled={busy}
          onClick={() => onResolve(approval, "reject", { feedback: feedback.trim() || undefined })}
        >
          {t("approval.plan.request_changes")}
        </button>
      </div>
    </div>
  );
}

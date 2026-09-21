import { useEffect, useRef, useState, type RefObject } from "react";
import ApprovalPanel from "../ApprovalPanel";
import ClarificationPanel from "../ClarificationPanel";
import { API_ROOT as apiRoot, type Approval, type PlanState, type PlanStep } from "../api";
import { useAppStore, type ChatEntry } from "../store";
import { useT } from "../i18n";
import { translateNarrative } from "../kernelNarrative";

type Props = {
  chat: ChatEntry[];
  chatMessage: string;
  busy: boolean;
  engineLabel: string;
  pendingApprovals?: Approval[];
  questions: any[];
  imageFile: File | null;
  plan?: PlanState | null;
  planMode: boolean;
  onPlanModeChange: (value: boolean) => void;
  onResolveApproval?: (approval: Approval, action: "approve" | "reject" | "edit", argsOverride?: Record<string, unknown>) => void;
  onClarificationContinue: (answers: string) => void;
  onChatMessageChange: (value: string) => void;
  onSendChat: () => void;
  onImageChange: (file: File | null) => void;
  inputRef?: RefObject<HTMLTextAreaElement>;
  onOpenSettings?: () => void;
  isPlannerConfigured?: boolean;
};

/** 步骤按零件分组（保留原顺序；无 part 归入"通用"组，part 为空串）。 */
function groupStepsByPart(steps: PlanStep[]): { part: string; steps: PlanStep[]; done: number }[] {
  const groups: { part: string; steps: PlanStep[]; done: number }[] = [];
  for (const step of steps) {
    const key = step.part || "";
    let group = groups.find((g) => g.part === key);
    if (!group) {
      group = { part: key, steps: [], done: 0 };
      groups.push(group);
    }
    group.steps.push(step);
    if (step.status === "completed") group.done += 1;
  }
  return groups;
}

export default function ChatColumn({
  chat,
  chatMessage,
  busy,
  engineLabel,
  pendingApprovals,
  questions,
  imageFile,
  plan,
  planMode,
  onPlanModeChange,
  onResolveApproval,
  onClarificationContinue,
  onChatMessageChange,
  onSendChat,
  onImageChange,
  inputRef,
  onOpenSettings,
  isPlannerConfigured = true,
}: Props) {
  const t = useT();
  const agentRunning = useAppStore((state) => state.agentRunning);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const jumpToLatest = () => {
    const stream = streamRef.current;
    if (stream) stream.scrollTop = stream.scrollHeight;
    followingRef.current = true;
    setFollowing(true);
  };

  useEffect(() => {
    if (!chat.length || followingRef.current) jumpToLatest();
  }, [chat]);

  return (
    <aside className="chat-column" aria-label={t("task.assistant")}>
      <div className="chat-column-header">
        <span className="eyebrow">AGENT</span>
        <strong>{t("task.assistant")}</strong>
        <span className="workspace-chip">{engineLabel}</span>
      </div>

      {plan && plan.steps.length > 0 && (
        <details className="plan-card">
          <summary>{t("chat.plan.progress", {
            done: plan.steps.filter((step) => step.status === "completed").length,
            total: plan.steps.length,
          })}</summary>
          {plan.summary && <div className="plan-summary">{plan.summary}</div>}
          {plan.bom && plan.bom.length > 0 && (
            <ul className="plan-bom-summary" data-testid="plan-bom-summary">
              {plan.bom.map((item) => (
                <li key={item.id || item.part} className="plan-bom-summary-item">
                  <span className="plan-bom-part">{item.part}</span>
                  {item.quantity && item.quantity > 1 ? <span className="plan-bom-qty">×{item.quantity}</span> : null}
                  {item.role ? <span className="plan-bom-role">{item.role}</span> : null}
                </li>
              ))}
            </ul>
          )}
          <ol className="plan-steps">
            {groupStepsByPart(plan.steps).map((group) => (
              <li key={group.part || "*"} className="plan-step-group">
                {group.part ? (
                  <div className={`plan-step-part-title ${group.done === group.steps.length ? "done" : ""}`}>
                    {group.done === group.steps.length ? "✓" : "○"} {group.part}
                    <span className="plan-step-part-progress">{group.done}/{group.steps.length}</span>
                  </div>
                ) : null}
                <ol className="plan-steps plan-steps-sub">
                  {group.steps.map((step) => (
                    <li key={step.id} className={`plan-step ${step.status}`}>
                      <span className="plan-step-mark" aria-hidden="true">
                        {step.status === "completed" ? "✓" : step.status === "in_progress" ? "▸" : "○"}
                      </span>
                      <span className="plan-step-title">{step.title}</span>
                      {step.op && <code className="plan-step-op">{step.op}</code>}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </details>
      )}

      {pendingApprovals && pendingApprovals.length > 0 && onResolveApproval && (
        <div className="chat-column-approvals">
          <ApprovalPanel approvals={pendingApprovals} busy={busy} onResolve={onResolveApproval} />
        </div>
      )}
      {questions.length > 0 && (
        <div className="chat-column-approvals">
          <ClarificationPanel questions={questions} onContinue={onClarificationContinue} disabled={busy} />
        </div>
      )}

      <div className="chat-stream" ref={streamRef} onScroll={(event) => {
        const stream = event.currentTarget;
        const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 64;
        followingRef.current = nearBottom;
        setFollowing(nearBottom);
      }}>
        {chat.length === 0 && <p className="empty-note">{t("task.chat.empty")}</p>}
        {chat.map((entry) => (
          <div key={entry.id} className={`chat-entry ${entry.role}`}>
            {entry.role === "user" ? (
              <div className="chat-bubble user">
                {entry.hasImage && <span className="chat-image-chip">{t("task.chat.image_attached")}</span>}
                <span className="chat-text">{entry.text}</span>
              </div>
            ) : (
              <div className={`chat-bubble assistant${entry.error ? " chat-bubble-error" : ""}`}>
                {entry.text && <span className="chat-text">{entry.text}</span>}
                {entry.status === "streaming" && !entry.text && entry.tools.length === 0 && <span className="chat-thinking">{t("task.chat.thinking")}</span>}
                {entry.status === "streaming" && <span className="chat-caret" aria-hidden="true" />}
                {entry.tools.map((card, index) => (
                  <div
                    key={`${card.step}-${index}`}
                    className={`chat-tool-card${card.success === false ? " failed" : ""}${card.autofix ? " autofix" : ""}`}
                  >
                    <span className="chat-tool-op">{card.autofix ? `${card.op} ·fix` : card.op}</span>
                    {card.argsPreview && <code className="chat-tool-args">{card.argsPreview}</code>}
                    {(card.summary || card.message) && (
                      <span className="chat-tool-summary">{translateNarrative(card.summary || card.message || "")}</span>
                    )}
                  </div>
                ))}
                {entry.snapshots.map((url, index) => (
                  <a key={`snap-${index}`} className="chat-snapshot-link" href={apiRoot + url} target="_blank" rel="noreferrer">
                    <img className="chat-snapshot" src={apiRoot + url} alt={t("task.chat.snapshot")} loading="lazy" />
                  </a>
                ))}
                {entry.action?.type === "open_settings" && onOpenSettings && (
                  <button type="button" className="chat-action-btn" onClick={onOpenSettings}>
                    {t("task.chat.open_settings")}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

      </div>

      {!following && <button type="button" className="chat-jump-latest" onClick={jumpToLatest}>
        {t("chat.latest")}
      </button>}
      <div className="chat-box">
        {imageFile && (
          <div className="chat-attach-bar">
            <span className="chat-image-chip">{t("chat.attached", { name: imageFile.name })}</span>
            <button type="button" className="chat-attach-remove" onClick={() => onImageChange(null)}>
              {t("chat.remove_image")}
            </button>
          </div>
        )}
        {!isPlannerConfigured && (
          <div className="chat-unconfigured-bar" onClick={onOpenSettings} role="button" tabIndex={0}>
            <span>{t("task.chat.unconfigured_warning")}</span>
            {onOpenSettings && <button type="button" className="chat-unconfigured-link">{t("task.chat.open_settings")}</button>}
          </div>
        )}
        <div className="chat-row">
          <span className="chat-prompt" aria-hidden="true">❯</span>
          <textarea
            rows={3}
            ref={inputRef}
            className="chat-input"
            value={chatMessage}
            onChange={(event) => onChatMessageChange(event.target.value)}
            placeholder={t("task.chat.placeholder")}
            aria-label={t("task.chat.placeholder")}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (chatMessage.trim()) onSendChat();
              }
            }}
          />
          <button
            type="button"
            className={`chat-plan-toggle${planMode ? " active" : ""}`}
            title={t("chat.plan_mode.title")}
            aria-pressed={planMode}
            onClick={() => onPlanModeChange(!planMode)}
          >
            {t("chat.plan_mode")}
          </button>
          <button
            type="button"
            className="chat-attach"
            title={t("chat.attach.title")}
            aria-label={t("chat.attach.title")}
            onClick={() => fileInputRef.current?.click()}
          >
            ＋
          </button>
          <button type="button" onClick={onSendChat} disabled={!chatMessage.trim()}>
            {t("task.chat.send")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            style={{ display: "none" }}
            onChange={(event) => onImageChange(event.target.files?.[0] || null)}
          />
        </div>
        <p className="hint">{agentRunning ? t("task.chat.queued_hint") : t("task.chat.hint")}</p>
      </div>
    </aside>
  );
}

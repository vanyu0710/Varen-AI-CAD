import { useEffect, useRef, useState, type RefObject } from "react";
import ApprovalPanel from "../ApprovalPanel";
import ClarificationPanel from "../ClarificationPanel";
import { API_ROOT as apiRoot, type Approval, type PlanState, type PlanStep, type ProcessStep } from "../api";
import { useAppStore, type AgentPhase, type ChatEntry } from "../store";
import { useT } from "../i18n";
import { translateNarrative } from "../kernelNarrative";

type Props = {
  chat: ChatEntry[]; chatMessage: string; busy: boolean; engineLabel: string; pendingApprovals?: Approval[]; questions: any[]; imageFile: File | null; plan?: PlanState | null; planMode: boolean; onPlanModeChange: (value: boolean) => void; onResolveApproval?: (approval: Approval, action: "approve" | "reject" | "edit", argsOverride?: Record<string, unknown>) => void; onClarificationContinue: (answers: string) => void; onChatMessageChange: (value: string) => void; onSendChat: () => void; onImageChange: (file: File | null) => void; inputRef?: RefObject<HTMLTextAreaElement>; onOpenSettings?: () => void; isPlannerConfigured?: boolean;
  events?: string[]; processSteps?: ProcessStep[]; agentSteps?: number; agentLastOp?: string; agentPhase?: AgentPhase; agentPhaseLabel?: string;
};

type AgentStage = "analyzing" | "planning" | "researching" | "modeling" | "validating" | "awaiting" | "completed" | "failed";
const stageOrder: AgentStage[] = ["analyzing", "planning", "researching", "modeling", "validating"];
const stageKeys: Record<AgentStage, string> = { analyzing: "agent.status.analyzing", planning: "agent.status.planning", researching: "agent.status.researching", modeling: "agent.status.modeling", validating: "agent.status.validating", awaiting: "agent.status.awaiting", completed: "agent.status.completed", failed: "agent.status.failed" };
function detectStage(text: string): AgentStage | null {
  const value = text.toLowerCase();
  if (/等待|confirm|approval|question|ask_user/.test(value)) return "awaiting";
  if (/校验|验证|validat|check|report/.test(value)) return "validating";
  if (/调研|research|standard|evidence|规范/.test(value)) return "researching";
  if (/规划|plan|featureplan/.test(value)) return "planning";
  if (/建模|model|extrude|hole|fillet|chamfer|create_|boolean|sweep/.test(value)) return "modeling";
  if (/分析|analy|vision|识别/.test(value)) return "analyzing";
  return null;
}
function stageFromProcess(step?: ProcessStep): AgentStage | null {
  if (!step) return null;
  if (step.status === "failed") return "failed";
  if (step.status === "blocked") return "awaiting";
  if (step.stage === "planning") return "planning";
  if (step.stage === "vision" || step.stage === "upload") return "analyzing";
  if (step.stage === "validation") return "validating";
  if (step.stage === "cad" || step.stage === "chat_edit" || step.stage === "export") return "modeling";
  return null;
}

function groupStepsByPart(steps: PlanStep[]): { part: string; steps: PlanStep[]; done: number }[] { const groups: { part: string; steps: PlanStep[]; done: number }[] = []; for (const step of steps) { const key = step.part || ""; let group = groups.find((g) => g.part === key); if (!group) { group = { part: key, steps: [], done: 0 }; groups.push(group); } group.steps.push(step); if (step.status === "completed") group.done += 1; } return groups; }

function AgentProgress({ agentRunning, agentSteps, agentLastOp, agentPhase, agentPhaseLabel, events = [], processSteps = [], pendingCount, questionCount, chat }: { agentRunning: boolean; agentSteps: number; agentLastOp: string; agentPhase?: AgentPhase; agentPhaseLabel?: string; events?: string[]; processSteps?: ProcessStep[]; pendingCount: number; questionCount: number; chat: ChatEntry[] }) {
  const t = useT();
  const latestStep = [...processSteps].reverse().find((step) => step.status === "running" || step.status === "failed" || step.status === "blocked") ?? processSteps.at(-1);
  const latestEvent = [...events].reverse().find((event) => !/连接|closed|unavailable/i.test(event));
  const failure = Boolean(latestStep?.status === "failed" || chat.some((entry) => entry.error));
  const backendStage: AgentStage | null = agentPhase === "awaiting_user" ? "awaiting" : agentPhase === "executing" ? "modeling" : agentPhase === "validating" ? "validating" : agentPhase === "researching" ? "researching" : agentPhase === "planning" ? "planning" : agentPhase === "completed" ? "completed" : agentPhase === "failed" ? "failed" : agentPhase === "stopped" || agentPhase === "partial" ? "completed" : agentPhase ? "analyzing" : null;
  const current: AgentStage = pendingCount + questionCount > 0 ? "awaiting" : failure ? "failed" : backendStage ?? stageFromProcess(latestStep) ?? detectStage(agentLastOp) ?? detectStage(latestEvent ?? "") ?? (agentRunning ? "analyzing" : processSteps.length ? "completed" : "analyzing");
  const visible = agentRunning || pendingCount + questionCount > 0 || Boolean(agentLastOp) || processSteps.length > 0;
  if (!visible) return null;
  const currentIndex = stageOrder.indexOf(current);
  const progress = current === "completed" ? 100 : current === "failed" || current === "awaiting" ? Math.max(15, Math.round(((Math.max(currentIndex, 0) + 1) / stageOrder.length) * 100)) : Math.round(((Math.max(currentIndex, 0) + 1) / stageOrder.length) * 100);
  const summary = agentPhaseLabel || latestStep?.detail || latestStep?.summary || agentLastOp || latestEvent || t(stageKeys[current]);
  return <section className={`agent-status-card ${current}${agentRunning ? " running" : ""}`} aria-label={t("agent.status.title")} role="status">
    <div className="agent-status-head"><span className="agent-status-orb" aria-hidden="true" /><div><strong>{t(stageKeys[current])}</strong><span>{t("agent.status.progress", { value: progress })}</span></div><span className="agent-status-step">{agentSteps > 0 ? t("agent.step", { step: agentSteps }) : ""}</span></div>
    <div className="agent-status-track" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
    <div className="agent-status-summary">{summary}</div>
    <div className="agent-status-stages">{stageOrder.map((stage) => <span key={stage} className={stage === current ? "current" : stageOrder.indexOf(stage) < currentIndex ? "done" : ""}>{stage === current ? "●" : stageOrder.indexOf(stage) < currentIndex ? "✓" : "○"} {t(stageKeys[stage])}</span>)}</div>
  </section>;
}

export default function ChatColumn(props: Props) {
  const { chat, chatMessage, busy, engineLabel, pendingApprovals, questions, imageFile, plan, planMode, onPlanModeChange, onResolveApproval, onClarificationContinue, onChatMessageChange, onSendChat, onImageChange, inputRef, onOpenSettings, isPlannerConfigured = true, events = [], processSteps = [], agentPhase, agentPhaseLabel } = props;
  const t = useT();
  const agentRunning = useAppStore((state) => state.agentRunning);
  const storeAgentSteps = useAppStore((state) => state.agentSteps);
  const storeAgentLastOp = useAppStore((state) => state.agentLastOp);
  const fileInputRef = useRef<HTMLInputElement | null>(null); const streamRef = useRef<HTMLDivElement | null>(null); const followingRef = useRef(true); const [following, setFollowing] = useState(true);
  const agentSteps = props.agentSteps ?? storeAgentSteps; const agentLastOp = props.agentLastOp ?? storeAgentLastOp;
  const jumpToLatest = () => { const stream = streamRef.current; if (stream) stream.scrollTop = stream.scrollHeight; followingRef.current = true; setFollowing(true); };
  useEffect(() => { if (!chat.length || followingRef.current) jumpToLatest(); }, [chat]);
  return <aside className="chat-column" aria-label={t("task.assistant")}>
    <div className="chat-column-header"><span className="eyebrow">AGENT</span><strong>{t("task.assistant")}</strong><span className="workspace-chip">{engineLabel}</span></div>
    <AgentProgress agentRunning={agentRunning} agentSteps={agentSteps} agentLastOp={agentLastOp} agentPhase={agentPhase} agentPhaseLabel={agentPhaseLabel} events={events} processSteps={processSteps} pendingCount={pendingApprovals?.length ?? 0} questionCount={questions.length} chat={chat} />
    {plan && plan.steps.length > 0 && <details className="plan-card"><summary>{t("chat.plan.progress", { done: plan.steps.filter((step) => step.status === "completed").length, total: plan.steps.length })}</summary>{plan.summary && <div className="plan-summary">{plan.summary}</div>}{plan.bom && plan.bom.length > 0 && <ul className="plan-bom-summary" data-testid="plan-bom-summary">{plan.bom.map((item) => <li key={item.id || item.part} className="plan-bom-summary-item"><span className="plan-bom-part">{item.part}</span>{item.quantity && item.quantity > 1 ? <span className="plan-bom-qty">×{item.quantity}</span> : null}{item.role ? <span className="plan-bom-role">{item.role}</span> : null}</li>)}</ul>}<ol className="plan-steps">{groupStepsByPart(plan.steps).map((group) => <li key={group.part || "*"} className="plan-step-group">{group.part ? <div className={`plan-step-part-title ${group.done === group.steps.length ? "done" : ""}`}>{group.done === group.steps.length ? "✓" : "○"} {group.part}<span className="plan-step-part-progress">{group.done}/{group.steps.length}</span></div> : null}<ol className="plan-steps plan-steps-sub">{group.steps.map((step) => <li key={step.id} className={`plan-step ${step.status}`}><span className="plan-step-mark" aria-hidden="true">{step.status === "completed" ? "✓" : step.status === "in_progress" ? "▸" : "○"}</span><span className="plan-step-title">{step.title}</span>{step.op && <code className="plan-step-op">{step.op}</code>}</li>)}</ol></li>)}</ol></details>}
    {((pendingApprovals?.length ?? 0) > 0 && onResolveApproval) || questions.length > 0 ? <div className="chat-decision-banner" role="status"><span aria-hidden="true">●</span>{t("chat.decision.pending", { count: ((onResolveApproval ? pendingApprovals?.length ?? 0 : 0) + questions.length) })}</div> : null}
    {pendingApprovals && pendingApprovals.length > 0 && onResolveApproval && <div className="chat-column-approvals"><ApprovalPanel approvals={pendingApprovals} busy={busy} onResolve={onResolveApproval} /></div>}
    {questions.length > 0 && <div className="chat-column-approvals"><ClarificationPanel questions={questions} onContinue={onClarificationContinue} disabled={busy} /></div>}
    <div className="chat-stream" ref={streamRef} onScroll={(event) => { const stream = event.currentTarget; const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 64; followingRef.current = nearBottom; setFollowing(nearBottom); }}>
      {chat.length === 0 && <p className="empty-note">{t("task.chat.empty")}</p>}
      {chat.map((entry) => <div key={entry.id} className={`chat-entry ${entry.role}`}>{entry.role === "user" ? <div className="chat-bubble user">{entry.hasImage && <span className="chat-image-chip">{t("task.chat.image_attached")}</span>}<span className="chat-text">{entry.text}</span></div> : <div className={`chat-bubble assistant${entry.error ? " chat-bubble-error" : ""}`}>{entry.text && <span className="chat-text">{entry.text}</span>}{entry.status === "streaming" && !entry.text && entry.tools.length === 0 && <span className="chat-thinking">{t("task.chat.thinking")}</span>}{entry.status === "streaming" && <span className="chat-caret" aria-hidden="true" />}{entry.tools.map((card, index) => <div key={`${card.step}-${index}`} className={`chat-tool-card${card.success === false ? " failed" : ""}${card.autofix ? " autofix" : ""}`}><span className="chat-tool-op">{card.autofix ? `${card.op} ·fix` : card.op}</span>{card.argsPreview && <code className="chat-tool-args">{card.argsPreview}</code>}{(card.summary || card.message) && <span className="chat-tool-summary">{translateNarrative(card.summary || card.message || "")}</span>}</div>)}{entry.snapshots.map((url, index) => <a key={`snap-${index}`} className="chat-snapshot-link" href={apiRoot + url} target="_blank" rel="noreferrer"><img className="chat-snapshot" src={apiRoot + url} alt={t("task.chat.snapshot")} loading="lazy" /></a>)}{entry.action?.type === "open_settings" && onOpenSettings && <button type="button" className="chat-action-btn" onClick={onOpenSettings}>{t("task.chat.open_settings")}</button>}</div>}</div>)}
    </div>
    {!following && <button type="button" className="chat-jump-latest" onClick={jumpToLatest}>{t("chat.latest")}</button>}
    <div className="chat-box">{imageFile && <div className="chat-attach-bar"><span className="chat-image-chip">{t("chat.attached", { name: imageFile.name })}</span><button type="button" className="chat-attach-remove" onClick={() => onImageChange(null)}>{t("chat.remove_image")}</button></div>}{!isPlannerConfigured && <div className="chat-unconfigured-bar" onClick={onOpenSettings} role="button" tabIndex={0}><span>{t("task.chat.unconfigured_warning")}</span>{onOpenSettings && <button type="button" className="chat-unconfigured-link">{t("task.chat.open_settings")}</button>}</div>}<div className="chat-row"><span className="chat-prompt" aria-hidden="true">❯</span><textarea rows={3} ref={inputRef} className="chat-input" value={chatMessage} onChange={(event) => onChatMessageChange(event.target.value)} placeholder={t("task.chat.placeholder")} aria-label={t("task.chat.placeholder")} onKeyDown={(event) => { if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return; if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (chatMessage.trim()) onSendChat(); } }} /><button type="button" className={`chat-plan-toggle${planMode ? " active" : ""}`} title={t("chat.plan_mode.title")} aria-pressed={planMode} onClick={() => onPlanModeChange(!planMode)}>{t("chat.plan_mode")}</button><button type="button" className="chat-attach" title={t("chat.attach.title")} aria-label={t("chat.attach.title")} onClick={() => fileInputRef.current?.click()}>＋</button><button type="button" onClick={onSendChat} disabled={!chatMessage.trim()}>{t("task.chat.send")}</button><input ref={fileInputRef} type="file" accept="image/png,image/jpeg" style={{ display: "none" }} onChange={(event) => onImageChange(event.target.files?.[0] || null)} /></div><p className="hint">{agentRunning ? t("task.chat.queued_hint") : t("task.chat.hint")}</p></div>
  </aside>;
}

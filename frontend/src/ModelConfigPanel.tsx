import { useEffect, useId, useMemo, useState } from "react";
import {
  applyModelEnvProfile,
  fetchEffectiveModels,
  fetchModelEnvState,
  fetchModelList,
  saveModelEnv,
  testModelConnection,
  type EffectiveModelsResult,
  type EffectiveRoleConfig,
  type ModelConfig,
  type ModelEnvState,
  type ModelRole,
  type ModelTestResult,
} from "./api";
import { useT } from "./i18n";
import { useAppStore } from "./store";
import { PROVIDER_PRESETS, applyProviderPreset, filterModelIds, findPreset, sortVisionLikelyFirst } from "./providers";

type Props = {
  value: ModelConfig;
  onChange: (value: ModelConfig) => void;
  onApply: () => void;
  dirty: boolean;
  notice: string;
  saving: boolean;
  disabled?: boolean;
  projectId?: string;
};

const MASK_RE = /^\*{3}configured(?::(.{1,8}))?\*{3}$/;
const isMasked = (v: string) => MASK_RE.test(v);
const keyTail = (v: string): string => v.match(MASK_RE)?.[1] ?? "";

type RoleState = {
  result?: ModelTestResult;
};

export default function ModelConfigPanel({ value, onChange, onApply, dirty, notice, saving, disabled, projectId }: Props) {
  const t = useT();
  const language = useAppStore((state) => state.language);
  const [results, setResults] = useState<Partial<Record<ModelRole, RoleState>>>({});
  const [testing, setTesting] = useState<ModelRole | "">("");
  const [exportNotice, setExportNotice] = useState("");
  const [effective, setEffective] = useState<EffectiveModelsResult | null>(null);
  const [effectiveLoading, setEffectiveLoading] = useState(false);
  const [effectiveError, setEffectiveError] = useState("");
  const [envState, setEnvState] = useState<ModelEnvState | null>(null);
  const [envLoading, setEnvLoading] = useState(false);
  const [envError, setEnvError] = useState("");
  const [envNotice, setEnvNotice] = useState("");
  const [envSavingRole, setEnvSavingRole] = useState<ModelRole | "">("");
  const [profileApplying, setProfileApplying] = useState<ModelRole | "">("");

  // 轻量防抖：面板打开与草稿变化时预览“应用后实际会走什么”；应用完成（dirty=false）也会刷新。
  useEffect(() => {
    if (!projectId) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setEffectiveLoading(true);
        try {
          const result = await fetchEffectiveModels(projectId, value);
          if (!cancelled) {
            setEffective(result);
            setEffectiveError("");
          }
        } catch (error) {
          if (!cancelled) {
            setEffectiveError(error instanceof Error ? error.message : String(error));
          }
        } finally {
          if (!cancelled) {
            setEffectiveLoading(false);
          }
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [projectId, value, dirty]);

  // .env 状态只在面板打开/项目切换时读取；草稿变化仍由 effective 接口单独预览。
  useEffect(() => {
    if (!projectId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      setEnvLoading(true);
      try {
        const result = await fetchModelEnvState(projectId);
        if (!cancelled) {
          setEnvState(result);
          setEnvError("");
        }
      } catch (error) {
        if (!cancelled) {
          setEnvError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setEnvLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const update = (patch: Partial<ModelConfig>) => onChange({ ...value, ...patch });

  const test = async (role: ModelRole) => {
    setTesting(role);
    try {
      const result = await testModelConnection(role, value, language);
      setResults((previous) => ({ ...previous, [role]: { result } }));
    } catch (error) {
      setResults((previous) => ({ ...previous, [role]: { result: { ok: false, role, provider: "", protocol: "", model: "", message: String(error), diagnostics: { used_env_fallback: false } } } }));
    } finally {
      setTesting("");
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setExportNotice(t("model.export.copied", { label }));
    } catch {
      setExportNotice(t("model.export.failed"));
    }
  };

  /** 导出时真实密钥绝不落地：仅保留服务端掩码（含尾号），本地新输入一律替换为 ***。 */
  const sanitizeForExport = (): ModelConfig => {
    const out: ModelConfig = { ...value };
    for (const role of ["vision", "planner"] as const) {
      const key = `${role}_api_key` as "vision_api_key" | "planner_api_key";
      const raw = out[key] || "";
      out[key] = raw && !isMasked(raw) ? "***" : raw;
    }
    return out;
  };

  const fillEffective = (role: ModelRole) => {
    const item = effective?.[role];
    if (!item) {
      return;
    }
    // 不填 API Key：项目 key 留空才能继续走 .env 密钥兜底，也避免把尾号误当成密钥。
    update({
      [`${role}_base_url`]: item.base_url,
      [`${role}_model`]: item.model,
      [`${role}_protocol`]: item.protocol,
    } as Partial<ModelConfig>);
  };

  const saveToEnv = async (role: ModelRole) => {
    if (!projectId || envSavingRole) {
      return;
    }
    setEnvSavingRole(role);
    setEnvNotice("");
    setEnvError("");
    try {
      // 掩码原样提交：后端可用项目里已存的真实 Key 写入本地 .env，前端始终拿不到密钥。
      const result = await saveModelEnv(projectId, value, role);
      setEnvState(result);
      setEnvNotice(t("model.env.saved"));
    } catch (error) {
      setEnvError(error instanceof Error ? error.message : String(error));
    } finally {
      setEnvSavingRole("");
    }
  };

  const applyProfile = async (role: ModelRole, provider: string) => {
    if (!projectId || profileApplying) {
      return;
    }
    setProfileApplying(role);
    setEnvNotice("");
    setEnvError("");
    try {
      await applyModelEnvProfile(projectId, role, provider);
      const result = await fetchModelEnvState(projectId);
      setEnvState(result);
      const profile = result.profiles[role].find((item) => item.provider === provider);
      // 后端已清掉该角色的项目覆盖；本地草稿同步置空，让预览立即显示 .env 生效值。
      onChange({
        ...value,
        [`${role}_provider`]: provider,
        [`${role}_api_key`]: "",
        [`${role}_base_url`]: "",
        [`${role}_model`]: "",
        [`${role}_protocol`]: profile?.protocol || "openai",
      } as ModelConfig);
      setEnvNotice(t("model.profile.applied"));
    } catch (error) {
      setEnvError(error instanceof Error ? error.message : String(error));
    } finally {
      setProfileApplying("");
    }
  };

  const exportEnv = () => {
    const config = sanitizeForExport();
    const lines: string[] = ["# Varen CAD — model console export (keys are masked)"];
    for (const role of ["VISION", "PLANNER"] as const) {
      const lower = role.toLowerCase() as ModelRole;
      lines.push(`MECHCAD_${role}_BASE_URL=${config[`${lower}_base_url`] || ""}`);
      lines.push(`MECHCAD_${role}_MODEL=${config[`${lower}_model`] || ""}`);
      lines.push(`MECHCAD_${role}_PROTOCOL=${config[`${lower}_protocol`] || "openai"}`);
      lines.push(`MECHCAD_${role}_API_KEY=${config[`${lower}_api_key`] || ""}`);
    }
    void copyText(lines.join("\n"), ".env");
  };

  return (
    <section className="model-console">
      <div className="console-bar">
        <RoleStatus role="vision" value={value} result={results.vision?.result} effective={effective?.vision} loading={effectiveLoading} dirty={dirty} />
        <RoleStatus role="planner" value={value} result={results.planner?.result} effective={effective?.planner} loading={effectiveLoading} dirty={dirty} />
        <div className="console-actions">
          <button type="button" className="ghost-button" onClick={() => void copyText(JSON.stringify(sanitizeForExport(), null, 2), "JSON")}>
            {t("model.export.json")}
          </button>
          <button type="button" className="ghost-button" onClick={exportEnv}>
            {t("model.export.env")}
          </button>
          <label className="confirm-check console-check" title={t("model.force_real.hint")}>
            <input type="checkbox" checked={Boolean(value.force_real_api)} onChange={(event) => update({ force_real_api: event.target.checked })} />
            <span>{t("model.force_real")}</span>
          </label>
          <button type="button" className="apply-settings" onClick={onApply} disabled={disabled || saving || !dirty}>
            {saving ? t("model.saving") : dirty ? t("model.apply") : t("model.applied")}
          </button>
        </div>
      </div>
      {exportNotice && <div className="export-notice">{exportNotice}</div>}

      <div className="effective-hint">
        <span>{t("model.effective.hint")}</span>
        <span>{t("model.env.hint")}</span>
        {envNotice && <span className="source-chip env">{envNotice}</span>}
        {(effectiveError || envError) && (
          <span className="effective-error">
            {effectiveError && `${t("model.effective.error")} ${effectiveError}`}
            {effectiveError && envError ? " · " : ""}
            {envError && `${t("model.env.error")} ${envError}`}
          </span>
        )}
      </div>

      <RoleConsole
        role="vision"
        value={value}
        onChange={onChange}
        disabled={disabled}
        testing={testing === "vision"}
        result={results.vision?.result}
        effective={effective?.vision}
        envState={envState}
        envLoading={envLoading}
        envSaving={envSavingRole === "vision"}
        profileApplying={profileApplying === "vision"}
        projectId={projectId}
        onFillEffective={fillEffective}
        onSaveEnv={saveToEnv}
        onApplyProfile={applyProfile}
        onTest={test}
      />
      <RoleConsole
        role="planner"
        value={value}
        onChange={onChange}
        disabled={disabled}
        testing={testing === "planner"}
        result={results.planner?.result}
        effective={effective?.planner}
        envState={envState}
        envLoading={envLoading}
        envSaving={envSavingRole === "planner"}
        profileApplying={profileApplying === "planner"}
        projectId={projectId}
        onFillEffective={fillEffective}
        onSaveEnv={saveToEnv}
        onApplyProfile={applyProfile}
        onTest={test}
      />

      {notice && <div className="settings-notice">{notice}</div>}
    </section>
  );
}

function RoleStatus({
  role,
  value,
  result,
  effective,
  loading,
  dirty,
}: {
  role: ModelRole;
  value: ModelConfig;
  result?: ModelTestResult;
  effective?: EffectiveRoleConfig;
  loading: boolean;
  dirty: boolean;
}) {
  const t = useT();
  const prefix = role as "vision" | "planner";
  const model = String(value[`${prefix}_model`] || "");
  const protocol = String(value[`${prefix}_protocol`] || "openai");
  const provider = String(value[`${prefix}_provider`] || "custom");
  const configured = Boolean(model && String(value[`${prefix}_base_url`] || "")) || Boolean(effective?.configured);
  const localTail = isMasked(String(value[`${prefix}_api_key`] || "")) ? keyTail(String(value[`${prefix}_api_key`] || "")) : "";
  const tail = localTail || effective?.api_key_tail || "";
  const dot = result ? (result.ok ? "ok" : "bad") : effective?.configured ? "idle" : "idle";
  const shownModel = model || effective?.model || (effective || loading ? "" : t("model.use_env"));
  return (
    <div className={`console-chip ${configured ? "configured" : "env"}`}>
      <span className={`status-dot ${dot}`} aria-hidden />
      <span className="chip-role">{role === "vision" ? t("model.vision") : t("model.planner")}</span>
      <code>{shownModel || (loading ? t("model.effective.loading") : t("model.source.none"))}</code>
      {effective && <span className={`source-chip ${effective.source}`}>{t(`model.source.${effective.source}`)}</span>}
      {dirty && <span className="source-chip draft">{t("model.effective.unapplied")}</span>}
      <span className="proto-chip">{protocol === "anthropic" ? "Anthropic" : "OpenAI"}</span>
      {provider && provider !== "custom" && <span className="provider-chip-label">{findPreset(provider)?.label ?? provider}</span>}
      {tail && <span className="key-chip">····{tail}</span>}
    </div>
  );
}

function RoleConsole({
  role,
  value,
  onChange,
  result,
  testing,
  onTest,
  onFillEffective,
  onSaveEnv,
  onApplyProfile,
  effective,
  envState,
  envLoading,
  envSaving,
  profileApplying,
  disabled,
  projectId,
}: {
  role: ModelRole;
  value: ModelConfig;
  onChange: (value: ModelConfig) => void;
  result?: ModelTestResult;
  testing: boolean;
  onTest: (role: ModelRole) => void;
  onFillEffective: (role: ModelRole) => void;
  onSaveEnv: (role: ModelRole) => void | Promise<void>;
  onApplyProfile: (role: ModelRole, provider: string) => void | Promise<void>;
  effective?: EffectiveRoleConfig;
  envState?: ModelEnvState | null;
  envLoading: boolean;
  envSaving: boolean;
  profileApplying: boolean;
  disabled?: boolean;
  projectId?: string;
}) {
  const t = useT();
  const language = useAppStore((state) => state.language);
  const f = (name: string) => `${role}_${name}` as keyof ModelConfig;
  const set = (patch: Partial<ModelConfig>) => onChange({ ...value, ...patch });
  const protocol = String(value[f("protocol")] || "openai");
  const preset = findPreset(String(value[f("provider")] || ""));
  const profiles = envState?.profiles[role] || [];

  return (
    <div className="role-console">
      <div className="role-card-title">
        <div>
          <strong>{role === "vision" ? t("model.vision.role") : t("model.planner.role")}</strong>
          <small>{role === "vision" ? t("model.vision.subtitle") : t("model.planner.subtitle")}</small>
        </div>
        <div className="role-head-actions">
          <div className="segmented" role="radiogroup" aria-label={t("model.protocol")}>
            <button type="button" role="radio" aria-checked={protocol === "openai"} className={protocol === "openai" ? "active" : ""} onClick={() => set({ [f("protocol")]: "openai" })}>
              OpenAI
            </button>
            <button type="button" role="radio" aria-checked={protocol === "anthropic"} className={protocol === "anthropic" ? "active" : ""} onClick={() => set({ [f("protocol")]: "anthropic" })}>
              Anthropic
            </button>
          </div>
          <button type="button" onClick={() => onTest(role)} disabled={disabled || testing}>
            {testing ? t("model.testing") : t("model.test")}
          </button>
          <button type="button" className="ghost-button" onClick={() => onFillEffective(role)} disabled={disabled || !effective}>
            {t("model.fill_effective")}
          </button>
          <button type="button" className="ghost-button" onClick={() => void onSaveEnv(role)} disabled={disabled || envSaving || !projectId}>
            {envSaving ? t("model.env.saving") : t("model.env.save")}
          </button>
        </div>
      </div>

      <div className="provider-gallery" role="listbox" aria-label={t("model.gallery")}>
        {PROVIDER_PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={preset?.id === item.id}
            className={`provider-chip ${preset?.id === item.id ? "active" : ""}`}
            disabled={profileApplying}
            style={{ ["--accent" as never]: item.accent }}
            onClick={() => {
              const profile = profiles.find((itemProfile) => itemProfile.provider === item.id);
              if (projectId && profile?.configured) {
                void onApplyProfile(role, item.id);
                return;
              }
              const next = applyProviderPreset(value, role, item.id);
              const modelKey = `${role}_model` as "vision_model" | "planner_model";
              const recommended = role === "vision" ? item.recommended_vision_model : item.recommended_planner_model;
              if (recommended && !next[modelKey]) {
                next[modelKey] = recommended;
              }
              onChange(next);
            }}
            title={profiles.some((itemProfile) => itemProfile.provider === item.id && itemProfile.configured) ? t("model.profile.apply") : item.base_url || t("model.preset.select")}
          >
            <span className="provider-dot" aria-hidden />
            {item.label}
            {profiles.some((itemProfile) => itemProfile.provider === item.id && itemProfile.configured) && (
              <span className="provider-saved">{t("model.profile.saved")}</span>
            )}
          </button>
        ))}
      </div>

      <div className="config-grid">
        <label className="field compact wide">
          <span className="field-label">
            {t("model.base_url")}
            <small>{t("model.base_url.hint")}</small>
          </span>
          <input
            value={String(value[f("base_url")] || "")}
            onChange={(event) => set({ [f("base_url")]: event.target.value })}
            placeholder={protocol === "anthropic" ? "https://api.anthropic.com" : "https://api.example.com/v1"}
            spellCheck={false}
          />
        </label>

        <ModelCombobox role={role} value={value} onChange={onChange} disabled={disabled} />

        <ApiKeyField role={role} value={value} onChange={onChange} disabled={disabled} keyUrl={preset?.key_url || ""} />
      </div>

      {envLoading && <div className="effective-hint">{t("model.env.loading")}</div>}
      {effective && !effective.configured && (
        <div className="effective-missing">
          {t("model.missing.prefix")}
          {effective.missing.map((field) => t(`model.missing.${field}`)).join("、")}
        </div>
      )}

      <details className="param-drawer">
        <summary>
          {t("model.params.title")}
          <small>{t("model.params.hint")}</small>
        </summary>
        <div className="param-grid">
          <ParamSlider label={t("model.param.temperature")} value={value[f("temperature")] as number | null | undefined} onChange={(v) => set({ [f("temperature")]: v })} />
          <ParamNumber label={t("model.param.max_tokens")} value={value[f("max_tokens")] as number | null | undefined} min={64} max={200000} step={64} integer placeholder="4096" onChange={(v) => set({ [f("max_tokens")]: v })} />
          <ParamNumber label={t("model.param.timeout")} value={value[f("timeout_s")] as number | null | undefined} min={5} max={600} step={5} integer placeholder="90" onChange={(v) => set({ [f("timeout_s")]: v })} />
          <ParamNumber label={t("model.param.retries")} value={value[f("max_retries")] as number | null | undefined} min={0} max={5} step={1} integer placeholder="1" onChange={(v) => set({ [f("max_retries")]: v })} />
        </div>
      </details>

      <TestLine result={result} />
    </div>
  );
}

function ModelCombobox({
  role,
  value,
  onChange,
  disabled,
}: {
  role: ModelRole;
  value: ModelConfig;
  onChange: (value: ModelConfig) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const language = useAppStore((state) => state.language);
  const [ids, setIds] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const field = `${role}_model` as "vision_model" | "planner_model";
  const current = String(value[field] || "");
  const list = useMemo(() => {
    if (!ids) return [];
    const filtered = filterModelIds(ids, current);
    return (role === "vision" ? sortVisionLikelyFirst(filtered) : filtered).slice(0, 80);
  }, [ids, current, role]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchModelList(role, value, language);
      if (result.ok && result.model_ids.length) {
        setIds(result.model_ids);
        setOpen(true);
      } else {
        setError(result.message || t("model.fetch.empty"));
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="model-combo wide" onBlur={(event) => {
      // 焦点真正离开整个 combobox 时才收起（onBlur 由 focusout 冒泡而来）。
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <span className="field-label">
        {t("model.name")}
        <small>{t("model.name.hint")}</small>
      </span>
      <div className="combo-row">
        <input
          value={current}
          onChange={(event) => {
            onChange({ ...value, [field]: event.target.value });
            if (ids) setOpen(true);
          }}
          onFocus={() => ids && setOpen(true)}
          placeholder={role === "vision" ? t("model.name.vision") : t("model.name.planner")}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="button" className="combo-fetch" onClick={() => void load()} disabled={disabled || loading}>
          {loading ? t("model.fetching") : ids ? t("model.refetch") : t("model.fetch")}
        </button>
        {ids && <span className="combo-count">{ids.length}</span>}
      </div>
      {error && <span className="combo-error">{error}</span>}
      {open && list.length > 0 && (
        <ul className="combo-menu" role="listbox">
          {list.map((id) => (
            <li key={id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={id === current}
                className={id === current ? "selected" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange({ ...value, [field]: id });
                  setOpen(false);
                }}
              >
                {id}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ApiKeyField({
  role,
  value,
  onChange,
  disabled,
  keyUrl,
}: {
  role: ModelRole;
  value: ModelConfig;
  onChange: (value: ModelConfig) => void;
  disabled?: boolean;
  keyUrl: string;
}) {
  const t = useT();
  const [reveal, setReveal] = useState(false);
  const field = `${role}_api_key` as keyof ModelConfig;
  const raw = String(value[field] || "");
  const masked = isMasked(raw);
  const tail = masked ? keyTail(raw) : "";
  return (
    <label className="field compact wide">
      <span className="field-label">
        {t("model.api_key")}
        {tail && <span className="key-badge">{t("model.key.saved", { tail })}</span>}
        {keyUrl && (
          <a className="key-link" href={keyUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
            {t("model.key.get")} ↗
          </a>
        )}
        <small>{masked ? t("model.key.replace_hint") : t("model.api_key.hint")}</small>
      </span>
      <div className="key-row">
        <input
          type={reveal ? "text" : "password"}
          value={raw}
          onChange={(event) => onChange({ ...value, [field]: event.target.value })}
          placeholder={masked ? "••••••••" : t("model.api_key.placeholder")}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
        />
        <button type="button" className="icon-toggle" onClick={() => setReveal((previous) => !previous)} title={reveal ? t("model.key.hide") : t("model.key.show")} aria-pressed={reveal}>
          {reveal ? "🙈" : "👁"}
        </button>
        {masked && (
          <button type="button" className="icon-toggle" onClick={() => onChange({ ...value, [field]: "" })} title={t("model.key.clear")}>
            ✕
          </button>
        )}
      </div>
    </label>
  );
}

function ParamSlider({ label, value, onChange }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void }) {
  const t = useT();
  const shown = value ?? 0.1;
  return (
    <div className="param-row">
      <span className="param-label">
        {label}
        <code>{value == null ? "0.1" : value.toFixed(2)}</code>
      </span>
      <input type="range" min={0} max={1} step={0.05} value={shown} onChange={(event) => onChange(Number(event.target.value))} />
      {value != null && (
        <button type="button" className="param-clear" onClick={() => onChange(null)}>
          {t("model.param.default")}
        </button>
      )}
    </div>
  );
}

function ParamNumber({
  label,
  value,
  min,
  max,
  step,
  placeholder,
  integer,
  onChange,
}: {
  label: string;
  value: number | null | undefined;
  min: number;
  max: number;
  step: number;
  placeholder: string;
  integer?: boolean;
  onChange: (v: number | null) => void;
}) {
  const t = useT();
  const labelId = useId();
  const errorId = useId();
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const [error, setError] = useState("");

  // External changes (profile switch, “use default”, project load) replace the draft.
  // A valid draft equals value, so this effect does not interrupt normal typing.
  useEffect(() => {
    setDraft(value == null ? "" : String(value));
    setError("");
  }, [value]);

  const parsed = Number(draft);
  const isCompleteNumber = draft.trim() !== "" && Number.isFinite(parsed);
  const isInvalidInteger = Boolean(integer && isCompleteNumber && !Number.isInteger(parsed));

  const commit = (next: number | null) => {
    setError("");
    onChange(next);
  };
  const restoreLastValid = () => {
    setDraft(value == null ? "" : String(value));
    setError("");
  };

  return (
    <div className={`param-row${error ? " has-error" : ""}`}>
      <span className="param-label">
        <span id={labelId}>{label}</span>
        <small>{t("model.param.default_of", { value: placeholder })}</small>
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        placeholder={placeholder}
        aria-labelledby={labelId}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          if (raw.trim() === "") {
            commit(null);
            return;
          }
          const next = Number(raw);
          if (!Number.isFinite(next)) {
            setError(t("model.param.invalid"));
            return;
          }
          if (next < min || next > max) {
            setError(t("model.param.range", { min, max }));
            return;
          }
          if (integer && !Number.isInteger(next)) {
            setError(t("model.param.integer"));
            return;
          }
          commit(next);
        }}
        onBlur={() => {
          if (draft.trim() === "") {
            commit(null);
            return;
          }
          if (!Number.isFinite(parsed) || isInvalidInteger) {
            restoreLastValid();
            return;
          }
          const next = Math.max(min, Math.min(max, parsed));
          setDraft(String(next));
          commit(next);
        }}
      />
      {value != null && (
        <button
          type="button"
          className="param-clear"
          onClick={() => {
            setDraft("");
            setError("");
            onChange(null);
          }}
        >
          {t("model.param.default")}
        </button>
      )}
      {error && (
        <span className="param-error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function TestLine({ result }: { result?: ModelTestResult }) {
  const t = useT();
  if (!result) {
    return null;
  }
  const diag = result.diagnostics || ({} as ModelTestResult["diagnostics"]);
  const latency = diag.elapsed_ms != null ? `${diag.elapsed_ms} ms` : null;
  return (
    <div className={`test-line ${result.ok ? "ok" : "fail"}`}>
      <span className={`status-dot ${result.ok ? "ok" : "bad"}`} aria-hidden />
      <strong>{result.ok ? t("model.test.ok") : t("model.test.fail.short")}</strong>
      {latency && <code>{latency}</code>}
      {diag.endpoint && <code className="test-endpoint">{diag.endpoint}</code>}
      {diag.used_env_fallback && <code>{t("model.diag.env")}</code>}
      {result.ok && diag.echo && <span className="test-echo">“{diag.echo}{diag.echo_truncated ? "…" : ""}”</span>}
      {!result.ok && <span className="test-reason">{result.message}</span>}
    </div>
  );
}

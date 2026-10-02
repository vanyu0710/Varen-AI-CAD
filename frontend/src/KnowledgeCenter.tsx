import { useCallback, useEffect, useRef, useState } from "react";
import {
  createResearchPlan,
  fetchKnowledgeCatalog,
  fetchKnowledgeDocuments,
  fetchResearchPlan,
  searchKnowledge,
  uploadKnowledgeDocument,
  type KnowledgeDocument,
  type KnowledgeDomain,
  type KnowledgeSearchResult,
  type ResearchPlan,
} from "./api";
import { useT } from "./i18n";

const ACCEPT = ".pdf,.docx,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.step,.stp,.stl";
const DOMAIN_LABEL: Record<string, string> = {
  sealing: "sealing / o_ring",
  fasteners: "fasteners / metric_screw",
  profiles: "profiles / aluminum_extrusion",
};

type Props = { projectId: string; onError: (message: string) => void };

export default function KnowledgeCenter({ projectId, onError }: Props) {
  const t = useT();
  const [domains, setDomains] = useState<KnowledgeDomain[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState<ResearchPlan | null>(null);
  const [goal, setGoal] = useState("");
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [includeExperiments, setIncludeExperiments] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [catalog, docs, currentPlan] = await Promise.all([
        fetchKnowledgeCatalog(projectId),
        fetchKnowledgeDocuments(projectId),
        fetchResearchPlan(projectId),
      ]);
      setDomains(catalog.domains);
      setDocuments(docs.documents);
      setPlan(currentPlan);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [projectId, onError]);

  useEffect(() => { void refresh(); }, [refresh]);

  const runSearch = async () => {
    setBusy(true);
    try {
      const payload = await searchKnowledge(projectId, { query, include_pending: true });
      setResults(payload.results);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      await uploadKnowledgeDocument(projectId, file);
      await refresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const createPlan = async () => {
    if (!goal.trim()) return;
    setBusy(true);
    try {
      setPlan(await createResearchPlan(projectId, { goal, domains: selectedDomains, include_experiments: includeExperiments }));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleDomain = (domain: string) => {
    setSelectedDomains((current) => current.includes(domain) ? current.filter((item) => item !== domain) : [...current, domain]);
  };

  return (
    <div className="knowledge-center">
      <header className="knowledge-header">
        <div>
          <strong>{t("knowledge.title")}</strong>
          <p>{t("knowledge.policy")}</p>
        </div>
        <span className={`knowledge-status${busy ? " busy" : ""}`}>{busy ? t("knowledge.loading") : t("knowledge.ready")}</span>
      </header>

      <section className="knowledge-domains">
        {domains.map((item) => (
          <button type="button" key={`${item.domain}-${item.component}`} className="knowledge-domain" onClick={() => toggleDomain(item.domain)} aria-pressed={selectedDomains.includes(item.domain)}>
            <strong>{DOMAIN_LABEL[`${item.domain}/${item.component}`] ?? `${item.domain}/${item.component}`}</strong>
            <span>{item.scope}</span>
            <em>{t("knowledge.status.scaffold")}</em>
          </button>
        ))}
      </section>

      <div className="knowledge-actions">
        <input ref={fileRef} type="file" accept={ACCEPT} onChange={(event) => void upload(event.target.files?.[0] || null)} disabled={busy} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>{t("knowledge.upload")}</button>
      </div>
      <p className="knowledge-note">{t("knowledge.pending_hint")}</p>

      {documents.length > 0 && (
        <section className="knowledge-documents">
          {documents.map((document) => (
            <article key={document.document_id} className={`knowledge-document ${document.status === "published" ? "published" : "pending"}`}>
              <strong>{document.title}</strong>
              <span>{document.filename}</span>
              <code>{document.sha256 ? `${document.sha256.slice(0, 12)}…` : "—"}</code>
              <em>{t(`knowledge.status.${document.status || "pending"}`)}</em>
            </article>
          ))}
        </section>
      )}

      <section className="knowledge-search">
        <div className="knowledge-search-row">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("knowledge.search_placeholder")} aria-label={t("knowledge.search_placeholder")} />
          <button type="button" onClick={() => void runSearch()} disabled={busy}>{t("knowledge.search")}</button>
        </div>
        {results.length > 0 && (
          <div className="knowledge-results">
            {results.map((result, index) => (
              <article key={`${result.kind}-${result.kind === "evidence" ? result.evidence_id : result.fact_id}-${index}`} className={`knowledge-result ${result.status === "published" ? "published" : "pending"}`}>
                <strong>{result.kind === "fact" ? `${result.domain}/${result.component} · ${result.parameter}` : t("knowledge.evidence")}</strong>
                <p>{result.kind === "fact" ? `${String(result.value)} ${result.unit || ""}` : result.original_text}</p>
                <em>{t(`knowledge.status.${result.status || "pending"}`)}</em>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="research-panel">
        <strong>{t("knowledge.research.title")}</strong>
        <p>{t("knowledge.research.hint")}</p>
        <textarea value={goal} onChange={(event) => setGoal(event.target.value)} placeholder={t("knowledge.research.placeholder")} />
        <label className="knowledge-checkbox"><input type="checkbox" checked={includeExperiments} onChange={(event) => setIncludeExperiments(event.target.checked)} />{t("knowledge.research.experiments")}</label>
        <button type="button" onClick={() => void createPlan()} disabled={busy || !goal.trim()}>{t("knowledge.research.create")}</button>
        {plan && (
          <div className="research-plan">
            <div className="research-plan-head"><strong>{plan.goal}</strong><span>{plan.evidence_policy}</span></div>
            {plan.tasks.map((task) => (
              <article key={task.task_id} className="research-task">
                <header><strong>{task.title}</strong><span>{task.role}</span></header>
                <p>{task.objective}</p>
                {(task.depends_on?.length || 0) > 0 && <small>{t("knowledge.research.depends", { count: task.depends_on!.length })}</small>}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

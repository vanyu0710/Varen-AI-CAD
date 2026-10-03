import { useCallback, useEffect, useState } from "react";
import {
  assemblyArtifactUrl,
  fetchEngineeringReview,
  type EngineeringCriticalPart,
  type EngineeringIssue,
  type EngineeringReview,
} from "./api";
import { useT } from "./i18n";

type Props = {
  projectId: string;
  onError: (message: string) => void;
};

export default function EngineeringReviewPanel({ projectId, onError }: Props) {
  const t = useT();
  const [review, setReview] = useState<EngineeringReview | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      setReview(await fetchEngineeringReview(projectId));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [projectId, onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const status = review?.status ?? "NO_DATA";
  const reportUrl = assemblyArtifactUrl(projectId, review?.assembly.report_file);
  const stepUrl = assemblyArtifactUrl(projectId, review?.assembly.step_file);

  return (
    <div className="engineering-review" data-testid="engineering-review">
      <header className="engineering-header">
        <div>
          <strong>{t("engineering.title")}</strong>
          <p>{t("engineering.policy")}</p>
        </div>
        <div className="engineering-header-meta">
          <span className={`engineering-status ${status.toLowerCase()}`}>{t(`engineering.status.${status.toLowerCase()}`)}</span>
          <button type="button" onClick={() => void refresh()} disabled={busy || !projectId}>
            {busy ? t("knowledge.loading") : t("engineering.refresh")}
          </button>
        </div>
      </header>

      {!review && <p className="engineering-empty">{t("engineering.loading")}</p>}
      {review && review.status === "NO_DATA" && <p className="engineering-empty">{t("engineering.no_data")}</p>}

      {review && review.status !== "NO_DATA" && (
        <>
          <section className="engineering-materials" aria-label={t("engineering.materials.title")}>
            <div className="engineering-section-head">
              <strong>{t("engineering.materials.title")}</strong>
              <span>{t("engineering.parts.count", { count: review.active_parts_count })}</span>
            </div>
            <p className="engineering-material-note">{t("engineering.materials.note")}</p>
            <div className="engineering-material-list">
              {review.materials.map((item) => (
                <article key={item.material} className="engineering-material" data-testid="engineering-material">
                  <strong>{item.material}</strong>
                  <span>{t("engineering.material.count", { count: item.part_count })}</span>
                  <em>{t(`engineering.basis.${item.basis}`)}</em>
                  <p>{item.parts.join(" · ")}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="engineering-parts" aria-label={t("engineering.parts.title")}>
            <div className="engineering-section-head">
              <strong>{t("engineering.parts.title")}</strong>
              <span>{t("engineering.parts.reviewed", { count: review.critical_parts.length })}</span>
            </div>
            <div className="engineering-part-list">
              {review.critical_parts.map((part) => (
                <CriticalPartCard key={part.part} part={part} />
              ))}
            </div>
          </section>

          <section className="engineering-assembly" aria-label={t("engineering.assembly.title")}>
            <div className="engineering-section-head">
              <strong>{t("engineering.assembly.title")}</strong>
              {review.assembly.exported_at && <time dateTime={review.assembly.exported_at}>{review.assembly.exported_at}</time>}
            </div>
            <dl className="engineering-metrics">
              <Metric label={t("engineering.assembly.parts_count")} value={review.assembly.parts_count} />
              <Metric label={t("engineering.assembly.total_pairs")} value={review.assembly.total_pairs} />
              <Metric label={t("engineering.assembly.hard_collision")} value={review.assembly.hard_collision_count} warn={review.assembly.hard_collision_count > 0} />
              <Metric label={t("engineering.assembly.expected_fit")} value={review.assembly.expected_fit_count} warn={review.assembly.expected_fit_count > 0} />
              <Metric label={t("engineering.assembly.expected_mesh")} value={review.assembly.expected_mesh_count} warn={review.assembly.expected_mesh_count > 0} />
            </dl>
            {review.assembly.blocking_issues.length > 0 && (
              <IssueList className="engineering-blocking" title={t("engineering.parts.blocking")} issues={review.assembly.blocking_issues} />
            )}
            {review.assembly.warning_issues.length > 0 && (
              <IssueList className="engineering-warnings" title={t("engineering.parts.warning")} issues={review.assembly.warning_issues} />
            )}
            {(review.assembly.excluded_superseded?.length || 0) > 0 && (
              <p className="engineering-excluded">{t("engineering.assembly.excluded")}: {review.assembly.excluded_superseded?.join(" · ")}</p>
            )}
            {(reportUrl || stepUrl) && (
              <div className="engineering-links">
                {stepUrl && <a href={stepUrl} download={review.assembly.step_file || undefined}>{t("engineering.assembly.step")}</a>}
                {reportUrl && <a href={reportUrl} download={review.assembly.report_file || undefined}>{t("engineering.assembly.report")}</a>}
              </div>
            )}
          </section>

          <section className="engineering-limitations" aria-label={t("engineering.limitations")}>
            <strong>{t("engineering.limitations")}</strong>
            <ul>
              {review.limitations.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function CriticalPartCard({ part }: { part: EngineeringCriticalPart }) {
  const t = useT();
  return (
    <article className={`engineering-part${part.blocking_issues.length ? " blocked" : ""}`} data-testid="engineering-part">
      <header>
        <strong>{part.part}</strong>
        {part.is_critical && <span>{t("engineering.parts.critical")}</span>}
      </header>
      <dl>
        <div><dt>{t("engineering.parts.version")}</dt><dd>{part.version ?? t("app.assembly.unknown")}</dd></div>
        <div><dt>{t("engineering.parts.role")}</dt><dd>{part.role || t("app.assembly.unknown")}</dd></div>
        <div><dt>{t("engineering.parts.material")}</dt><dd>{part.material}</dd></div>
        <div><dt>{t("engineering.parts.volume")}</dt><dd>{part.volume_mm3 == null ? t("app.assembly.unknown") : `${part.volume_mm3.toFixed(2)} mm³`}</dd></div>
      </dl>
      {part.blocking_issues.length > 0 && <IssueList className="engineering-blocking" title={t("engineering.parts.blocking")} issues={part.blocking_issues} />}
      {part.warning_issues.length > 0 && <IssueList className="engineering-warnings" title={t("engineering.parts.warning")} issues={part.warning_issues} />}
      {part.criticality_reasons && part.criticality_reasons.length > 0 && (
        <p className="engineering-reasons">
          {part.criticality_reasons.map((reason) => t(`engineering.reason.${reason}`)).filter(Boolean).join(" · ")}
        </p>
      )}
    </article>
  );
}

function IssueList({ title, issues, className }: { title: string; issues: EngineeringIssue[]; className: string }) {
  const t = useT();
  return (
    <div className={`engineering-issues ${className}`} role="list">
      <strong>{title}</strong>
      {issues.map((issue, index) => (
        <p key={`${issue.code}-${index}`} role="listitem">
          {t(`engineering.issue.${issue.code}`) === `engineering.issue.${issue.code}` ? issue.message : t(`engineering.issue.${issue.code}`)}
          {issue.parts && issue.parts.length > 0 ? ` · ${issue.parts.join(" · ")}` : ""}
        </p>
      ))}
    </div>
  );
}

function Metric({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return <div className={warn ? "warn" : ""}><dt>{label}</dt><dd>{value}</dd></div>;
}

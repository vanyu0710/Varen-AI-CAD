import type { AssemblySummary } from "../api";
import { useT } from "../i18n";

/** Reported export evidence only; no inferred certification from collision counts. */
export default function AssemblyCheckSummary({ assembly }: { assembly: AssemblySummary }) {
  const t = useT();
  const count = (value: number | null | undefined) =>
    typeof value === "number" && Number.isInteger(value) && value >= 0
      ? value : t("app.assembly.unknown");
  const metrics = [
    ["parts", assembly.parts_count],
    ["pairs", assembly.total_pairs],
    ["hard", assembly.hard_collision_count],
    ["fit", assembly.expected_fit_count],
    ["mesh", assembly.expected_mesh_count],
  ] as const;
  const hasErrors = assembly.pairs?.some((pair) => pair.error);
  return <div className="assembly-check-summary">
    <dl className="assembly-metrics">
      {metrics.map(([key, value]) => <div key={key} className={key === "hard" && typeof value === "number" && value > 0 ? "warn" : ""}>
        <dt>{t(`app.assembly.metric.${key}`)}</dt><dd>{count(value)}</dd>
      </div>)}
    </dl>
    <p className="assembly-scope">{t("app.assembly.scope")}
      {assembly.exported_at && <time dateTime={assembly.exported_at}> · {assembly.exported_at}</time>}
    </p>
    {hasErrors && <p className="assembly-check-error" role="alert">{t("app.assembly.check_error")}</p>}
  </div>;
}

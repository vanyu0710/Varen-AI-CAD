import type { InterferencePair } from "../api";
import { useT } from "../i18n";

type Props = {
  pairs: InterferencePair[];
  selected?: string | null;
  onSelectPart?: (name: string) => void;
};

function formatNumber(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function formatCenter(center: number[] | null | undefined): string {
  if (!Array.isArray(center) || center.length !== 3 || center.some((v) => !Number.isFinite(v))) {
    return "—";
  }
  return `(${center.map((v) => Number(v).toFixed(2)).join(", ")})`;
}

/** Pair-level diagnostic evidence. Selection is explicit; no automatic geometry edits. */
export default function InterferencePairs({ pairs, selected, onSelectPart }: Props) {
  const t = useT();
  const visible = pairs.filter((pair) =>
    pair.interfering || pair.diagnostic_status === "calculation_error" ||
    (pair.error && !pair.interfering));
  if (!visible.length) {
    return null;
  }
  const partButton = (name: string) => (
    <button
      type="button"
      className={`assembly-interference-part${selected === name ? " selected" : ""}`}
      aria-label={t("app.assembly.interference.select_part", { name })}
      onClick={() => onSelectPart?.(name)}
    >
      {name}
    </button>
  );
  return (
    <div className="assembly-interference-list" data-testid="assembly-interference">
      <span className="eyebrow">{t("app.assembly.interference_pair_title")}</span>
      {visible.map((pair, index) => {
        const key = pair.pair_id || `${pair.name_a}|${pair.name_b}|${index}`;
        const isError = pair.diagnostic_status === "calculation_error" ||
          (pair.error && !pair.interfering);
        return (
          <article key={key} className={`assembly-interference-pair${isError ? " calculation-error" : ""}`} data-pair-id={pair.pair_id || ""}>
            <div className="assembly-interference-names">
              {partButton(pair.name_a)}
              <span aria-hidden="true">×</span>
              {partButton(pair.name_b)}
            </div>
            <dl>
              <div>
                <dt>{t("app.assembly.interference.volume")}</dt>
                <dd>{isError ? "—" : `${formatNumber(pair.volume_mm3, 1)} mm³`}</dd>
              </div>
              <div>
                <dt>{t("app.assembly.interference.center")}</dt>
                <dd>{isError ? "—" : formatCenter(pair.center)}</dd>
              </div>
            </dl>
            {isError && (
              <p className="assembly-interference-error" role="alert">
                {t("app.assembly.interference.diagnostic_error")}
                {pair.error ? `: ${pair.error}` : ""}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}

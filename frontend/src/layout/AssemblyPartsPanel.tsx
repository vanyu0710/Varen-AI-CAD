import { useMemo, useState } from "react";
import type { PartArtifact } from "../api";
import { useT } from "../i18n";

type Filter = "all" | "visible" | "interference";

type Props = {
  parts: PartArtifact[];
  hidden: string[];
  selected: string | null;
  interfering: string[];
  onHiddenChange: (hidden: string[]) => void;
  onSelect: (name: string | null) => void;
};

function formatPosition(position?: number[]): string {
  if (!Array.isArray(position) || position.length !== 3 || position.some((v) => !Number.isFinite(v))) {
    return "—";
  }
  return `[${position.map((v) => Math.round(v)).join(", ")}]`;
}

/** Compact assembly browser: search, filter, isolate, and per-part visibility. */
export default function AssemblyPartsPanel({
  parts,
  hidden,
  selected,
  interfering,
  onHiddenChange,
  onSelect,
}: Props) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const interferingSet = useMemo(() => new Set(interfering), [interfering]);
  const visibleCount = parts.length - hidden.length;
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = parts.filter((part) => {
    const matchesQuery = !normalizedQuery || part.part.toLowerCase().includes(normalizedQuery);
    const matchesFilter =
      filter === "all" ||
      (filter === "visible" && !hidden.includes(part.part)) ||
      (filter === "interference" && interferingSet.has(part.part));
    return matchesQuery && matchesFilter;
  });

  const setPartVisible = (name: string, visible: boolean) => {
    onHiddenChange(visible ? hidden.filter((item) => item !== name) : [...hidden, name]);
  };
  const isolatePart = (name: string) => {
    onHiddenChange(parts.filter((part) => part.part !== name).map((part) => part.part));
    onSelect(name);
  };

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: t("app.assembly.filter.all"), count: parts.length },
    { id: "visible", label: t("app.assembly.filter.visible"), count: visibleCount },
    { id: "interference", label: t("app.assembly.filter.interference"), count: interfering.length },
  ];

  return (
    <section className="assembly-parts-panel" data-testid="assembly-parts-panel" aria-label={t("app.assembly.visibility")}>
      <div className="assembly-parts-toolbar">
        <span className="assembly-parts-count">
          {t("app.assembly.part_count", { total: parts.length, visible: visibleCount })}
        </span>
        <input
          className="assembly-parts-search"
          type="search"
          value={query}
          placeholder={t("app.assembly.search")}
          aria-label={t("app.assembly.search")}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="assembly-parts-filters" role="group" aria-label={t("app.assembly.filter")}>
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              className={filter === item.id ? "active" : ""}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label} · {item.count}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="assembly-parts-show-all"
          disabled={!hidden.length}
          onClick={() => onHiddenChange([])}
        >
          {t("app.assembly.show_all")}
        </button>
      </div>
      {filtered.length ? (
        <div className="assembly-parts">
          {filtered.map((part) => {
            const visible = !hidden.includes(part.part);
            const isSelected = selected === part.part;
            const hasInterference = interferingSet.has(part.part);
            return (
              <div
                key={part.part}
                className={`assembly-part${isSelected ? " selected" : ""}${visible ? "" : " hidden-part"}${hasInterference ? " interference" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={visible}
                  aria-label={t("app.assembly.visible_part", { name: part.part })}
                  onChange={(event) => setPartVisible(part.part, event.target.checked)}
                />
                <button
                  type="button"
                  className="assembly-part-name"
                  aria-pressed={isSelected}
                  onClick={() => onSelect(isSelected ? null : part.part)}
                >
                  {part.part}
                </button>
                {hasInterference && <span className="assembly-part-flag">{t("app.assembly.interference_badge")}</span>}
                <span className="assembly-part-pose" title={JSON.stringify(part.pose || null)}>
                  {formatPosition(part.pose?.position)}
                </span>
                <button
                  type="button"
                  className="assembly-part-solo"
                  onClick={() => isolatePart(part.part)}
                >
                  {t("app.assembly.solo_part")}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="assembly-parts-empty">{t("app.assembly.no_matches")}</p>
      )}
    </section>
  );
}

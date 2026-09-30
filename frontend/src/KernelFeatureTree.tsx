import { useMemo, useState } from "react";
import type { KernelFeatureData } from "./api";
import { useT } from "./i18n";

type Props = {
  opHistory: Array<Record<string, unknown>>;
  nodes: Record<string, KernelFeatureData>;
  selectedFeatureId: string;
  onSelectFeature: (id: string) => void;
  onDeleteFeature?: (id: string) => void;
  /** Optional integrations for a host viewport. The tree remains usable without them. */
  onToggleVisibility?: (id: string, visible: boolean) => void;
  onIsolateFeature?: (id: string) => void;
  onFocusFeature?: (id: string) => void;
};

type Row = {
  id: string;
  label: string;
  detail: string;
  state: string;
  depth: number;
  parentId: string | null;
};

/** Parameterized feature history rendered as a collapsible CAD-style model tree. */
export default function KernelFeatureTree({
  opHistory,
  nodes,
  selectedFeatureId,
  onSelectFeature,
  onDeleteFeature,
  onToggleVisibility,
  onIsolateFeature,
  onFocusFeature,
}: Props) {
  const t = useT();
  const rows = useMemo<Row[]>(() => {
    const parentOf: Record<string, string | null> = {};
    for (const [id, node] of Object.entries(nodes)) parentOf[id] = node.parent_id ?? null;
    return opHistory
      .map((entry) => {
        const id = String(entry.feature_id ?? entry.id ?? "");
        const node = nodes[id] ?? {};
        const type = String(node.type ?? entry.op ?? entry.type ?? "");
        const name = String(node.name ?? entry.name ?? "");
        const parentId = parentOf[id] ?? (entry.parent_id ? String(entry.parent_id) : null);
        return {
          id,
          label: name || type || id,
          detail: [type, name].filter(Boolean).join(" · "),
          state: String(node.state ?? "COMPUTED"),
          depth: 0,
          parentId,
        };
      })
      .filter((row) => row.id);
  }, [opHistory, nodes]);

  const children = useMemo(() => {
    const map = new Map<string | null, Row[]>();
    for (const row of rows) {
      const parent = rows.some((candidate) => candidate.id === row.parentId) ? row.parentId : null;
      const bucket = map.get(parent) ?? [];
      bucket.push({ ...row, depth: parent ? 1 : 0 });
      map.set(parent, bucket);
    }
    return map;
  }, [rows]);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());

  if (!rows.length) return <div className="kernel-tree-empty">{t("tree.empty")}</div>;

  const toggleVisibility = (id: string) => {
    const visible = hiddenIds.has(id);
    setHiddenIds((current) => {
      const next = new Set(current);
      if (visible) next.delete(id); else next.add(id);
      return next;
    });
    onToggleVisibility?.(id, visible);
  };
  const isolate = (id: string) => {
    setHiddenIds(new Set(rows.map((row) => row.id).filter((rowId) => rowId !== id)));
    onSelectFeature(id);
    onIsolateFeature?.(id);
  };
  const focus = (id: string) => {
    onSelectFeature(id);
    onFocusFeature?.(id);
  };

  const renderRows = (parentId: string | null, depth: number, ancestors = new Set<string>()): React.ReactNode[] => {
    return (children.get(parentId) ?? []).flatMap((row) => {
      if (ancestors.has(row.id)) return [];
      const descendants = children.has(row.id);
      const nextAncestors = new Set(ancestors).add(row.id);
      const nested = descendants && !collapsedIds.has(row.id) ? renderRows(row.id, depth + 1, nextAncestors) : [];
      return [
        <li key={row.id} className={`kernel-tree-row ${row.id === selectedFeatureId ? "selected" : ""} state-${row.state.toLowerCase()}${hiddenIds.has(row.id) ? " hidden" : ""}`}>
          <div className="kernel-tree-main" style={{ paddingLeft: 8 + depth * 14 }}>
            {descendants ? (
              <button
                type="button"
                className="kernel-tree-expander"
                aria-label={collapsedIds.has(row.id) ? t("kernel.tree.expand") : t("kernel.tree.collapse")}
                onClick={() => setCollapsedIds((current) => {
                  const next = new Set(current);
                  if (next.has(row.id)) next.delete(row.id); else next.add(row.id);
                  return next;
                })}
              >{collapsedIds.has(row.id) ? "▸" : "▾"}</button>
            ) : <span className="kernel-tree-expander-spacer" aria-hidden="true" />}
            <button type="button" className="kernel-tree-select" onClick={() => onSelectFeature(row.id)}>
              <span className="kernel-tree-label">{row.label}</span>
              <span className="kernel-tree-detail">{row.detail}</span>
              <span className="kernel-tree-state">{row.state}</span>
            </button>
            <button type="button" className="kernel-tree-action" aria-label={hiddenIds.has(row.id) ? t("kernel.tree.show") : t("kernel.tree.hide")} title={hiddenIds.has(row.id) ? t("kernel.tree.show") : t("kernel.tree.hide")} onClick={() => toggleVisibility(row.id)}>
              {hiddenIds.has(row.id) ? "○" : "◉"}
            </button>
            <button type="button" className="kernel-tree-action" aria-label={t("kernel.tree.isolate")} title={t("kernel.tree.isolate")} onClick={() => isolate(row.id)}>⊙</button>
            <button type="button" className="kernel-tree-action" aria-label={t("kernel.tree.focus")} title={t("kernel.tree.focus")} onClick={() => focus(row.id)}>⌖</button>
            {onDeleteFeature && <button type="button" className="kernel-tree-delete" title={t("kernel.tree.delete")} onClick={() => onDeleteFeature(row.id)}>×</button>}
          </div>
        </li>,
        ...nested,
      ];
    });
  };

  return <ul className="kernel-tree" aria-label={t("manager.feature_tree")}>{renderRows(null, 0)}</ul>;
}

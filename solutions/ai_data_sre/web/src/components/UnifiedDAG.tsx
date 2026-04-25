import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IncidentDetail, BlastRadius } from '../types';

/* ──────────────────────────────────────────────────────────────────────────
 *  UnifiedDAG — a single lineage graph built from ALL active incidents.
 *
 *  Nodes are positioned by topological layer (left → right) with SVG
 *  bezier edges drawn between the actual connected tables, so the flow
 *  reads:  raw_orders → staging_orders → fact_order_metrics → exec_dashboard_kpis
 * ────────────────────────────────────────────────────────────────────────── */

interface Props {
  details: IncidentDetail[];
  omBaseUrl: string;
}

/* ── Internal types ─────────────────────────────────────────────────────── */

interface DAGNode {
  fqn: string;
  name: string;
  failingIncidents: string[];
  rootCauseFor: string[];
  incidentTitles: Record<string, string>;
  rootCauseColumns: Record<string, string>;
  tier: string | null;
  owners: string[];
  layer: number;
  row: number;
}

interface DAGEdge {
  from: string;
  to: string;
}

/* ── Layout constants ───────────────────────────────────────────────────── */

const NODE_W = 152;
const NODE_H = 58;
const LAYER_GAP = 72;
const ROW_GAP = 20;
const PAD_X = 28;
const PAD_Y = 40;

/* ── Graph builder ──────────────────────────────────────────────────────── */

function buildDAG(details: IncidentDetail[]): { nodes: DAGNode[]; edges: DAGEdge[] } {
  const nodeMap = new Map<string, DAGNode>();
  const edgeSet = new Set<string>();
  const edges: DAGEdge[] = [];

  const ensureNode = (fqn: string, tier?: string | null, owners?: string[]): DAGNode => {
    let node = nodeMap.get(fqn);
    if (!node) {
      node = {
        fqn,
        name: fqn.split('.').pop() ?? fqn,
        failingIncidents: [],
        rootCauseFor: [],
        incidentTitles: {},
        rootCauseColumns: {},
        tier: null,
        owners: [],
        layer: 0,
        row: 0,
      };
      nodeMap.set(fqn, node);
    }
    if (tier && !node.tier) node.tier = tier;
    if (owners?.length && !node.owners.length) node.owners = owners;
    return node;
  };

  const addEdge = (from: string, to: string) => {
    if (from === to) return;
    const key = `${from}→${to}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push({ from, to });
    }
  };

  for (const detail of details) {
    const br: BlastRadius | null = detail.blast_radius;
    if (!br) continue;

    const failTableFqn = detail.failures?.[0]?.table_fqn;
    if (failTableFqn) {
      const failNode = ensureNode(failTableFqn);
      if (!failNode.failingIncidents.includes(detail.id)) {
        failNode.failingIncidents.push(detail.id);
      }
      failNode.incidentTitles[detail.id] = detail.title;
    }

    const rootNode = ensureNode(br.root_cause_table);
    if (!rootNode.rootCauseFor.includes(detail.id)) {
      rootNode.rootCauseFor.push(detail.id);
    }
    rootNode.incidentTitles[detail.id] = detail.title;
    if (br.root_cause_column) {
      rootNode.rootCauseColumns[detail.id] = br.root_cause_column;
    }

    // Build path: root_cause → upstream (reversed) → failTable
    const upstreamFqns = br.upstream_chain.map((a) => a.fqn);
    const fullPath = [br.root_cause_table, ...[...upstreamFqns].reverse()];
    if (failTableFqn && !fullPath.includes(failTableFqn)) {
      fullPath.push(failTableFqn);
    }
    for (let i = 0; i < fullPath.length - 1; i++) {
      const from = fullPath[i]!;
      const to = fullPath[i + 1]!;
      ensureNode(from);
      ensureNode(to);
      addEdge(from, to);
    }

    for (const asset of br.upstream_chain) {
      ensureNode(asset.fqn, asset.tier, asset.owners);
    }

    // Downstream: chain by depth
    const downByDepth = new Map<number, string>();
    const startFqn = failTableFqn ?? br.root_cause_table;
    downByDepth.set(0, startFqn);
    for (const asset of br.downstream_impact) {
      const n = ensureNode(asset.fqn, asset.tier, asset.owners);
      const prevFqn = downByDepth.get(asset.depth - 1) ?? startFqn;
      addEdge(prevFqn, n.fqn);
      downByDepth.set(asset.depth, n.fqn);
    }
  }

  // Longest-path topological layering
  const adjOut = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const node of nodeMap.values()) {
    adjOut.set(node.fqn, []);
    inDeg.set(node.fqn, 0);
  }
  for (const e of edges) {
    adjOut.get(e.from)?.push(e.to);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [fqn, deg] of inDeg.entries()) {
    if (deg === 0) queue.push(fqn);
  }
  while (queue.length > 0) {
    const fqn = queue.shift()!;
    const node = nodeMap.get(fqn)!;
    for (const next of adjOut.get(fqn) ?? []) {
      const nextNode = nodeMap.get(next)!;
      nextNode.layer = Math.max(nextNode.layer, node.layer + 1);
      const newDeg = (inDeg.get(next) ?? 1) - 1;
      inDeg.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  // Row positions within each layer (sorted by name for stability)
  const layerMap = new Map<number, DAGNode[]>();
  for (const node of nodeMap.values()) {
    const arr = layerMap.get(node.layer) ?? [];
    arr.push(node);
    layerMap.set(node.layer, arr);
  }
  for (const [, layerNodes] of layerMap) {
    layerNodes.sort((a, b) => a.name.localeCompare(b.name));
    layerNodes.forEach((n, i) => { n.row = i; });
  }

  return { nodes: Array.from(nodeMap.values()), edges };
}

/* ── Component ──────────────────────────────────────────────────────────── */

export function UnifiedDAG({ details, omBaseUrl }: Props) {
  const [hoveredFqn, setHoveredFqn] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { nodes, edges } = useMemo(() => buildDAG(details), [details]);

  // Compute canvas dimensions and node positions
  const { canvasW, canvasH, positions } = useMemo(() => {
    // Gather layer sizes
    const layerSizes = new Map<number, number>();
    let maxLayer = 0;
    for (const n of nodes) {
      layerSizes.set(n.layer, (layerSizes.get(n.layer) ?? 0) + 1);
      maxLayer = Math.max(maxLayer, n.layer);
    }
    const maxRows = Math.max(1, ...layerSizes.values());
    const totalMaxH = maxRows * NODE_H + (maxRows - 1) * ROW_GAP;

    const w = PAD_X * 2 + (maxLayer + 1) * NODE_W + maxLayer * LAYER_GAP;
    const h = PAD_Y + totalMaxH + 20;

    const pos = new Map<string, { x: number; y: number }>();
    for (const node of nodes) {
      const lSize = layerSizes.get(node.layer) ?? 1;
      const layerH = lSize * NODE_H + (lSize - 1) * ROW_GAP;
      const offsetY = (totalMaxH - layerH) / 2;
      pos.set(node.fqn, {
        x: PAD_X + node.layer * (NODE_W + LAYER_GAP),
        y: PAD_Y + offsetY + node.row * (NODE_H + ROW_GAP),
      });
    }

    return { canvasW: w, canvasH: h, positions: pos, maxLayer };
  }, [nodes]);

  // Hover: which nodes to highlight
  const highlighted = useMemo<Set<string>>(() => {
    if (!hoveredFqn) return new Set();
    const hoveredNode = nodes.find((n) => n.fqn === hoveredFqn);
    if (!hoveredNode) return new Set();

    const set = new Set<string>();
    if (hoveredNode.failingIncidents.length > 0) {
      for (const incId of hoveredNode.failingIncidents) {
        for (const n of nodes) {
          if (n.rootCauseFor.includes(incId)) set.add(n.fqn);
        }
      }
    }
    if (hoveredNode.rootCauseFor.length > 0) {
      for (const incId of hoveredNode.rootCauseFor) {
        for (const n of nodes) {
          if (n.failingIncidents.includes(incId)) set.add(n.fqn);
        }
      }
    }
    return set;
  }, [hoveredFqn, nodes]);

  // Highlighted edges: paths between hovered and highlighted
  const highlightedEdges = useMemo<Set<string>>(() => {
    if (!hoveredFqn || highlighted.size === 0) return new Set();
    const relevant = new Set([hoveredFqn, ...highlighted]);

    const adjFwd = new Map<string, string[]>();
    for (const e of edges) {
      const arr = adjFwd.get(e.from) ?? [];
      arr.push(e.to);
      adjFwd.set(e.from, arr);
    }

    const result = new Set<string>();
    for (const src of relevant) {
      // BFS forward, recording parent pointers
      const parent = new Map<string, string | null>();
      parent.set(src, null);
      const q = [src];
      while (q.length > 0) {
        const cur = q.shift()!;
        for (const next of adjFwd.get(cur) ?? []) {
          if (!parent.has(next)) {
            parent.set(next, cur);
            q.push(next);
          }
        }
      }
      // Trace back from each reached relevant node
      for (const tgt of relevant) {
        if (tgt === src || !parent.has(tgt)) continue;
        let cur: string | null = tgt;
        while (cur !== null && cur !== src) {
          const p: string | null = parent.get(cur) ?? null;
          if (p) result.add(`${p}→${cur}`);
          cur = p;
        }
      }
    }
    return result;
  }, [hoveredFqn, highlighted, edges]);

  const handleMouseEnter = useCallback((fqn: string) => setHoveredFqn(fqn), []);
  const handleMouseLeave = useCallback(() => setHoveredFqn(null), []);

  useEffect(() => {
    containerRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
  }, []);

  if (nodes.length === 0) return null;

  const layerLabels = ['Sources', 'Staging', 'Facts', 'Executive', 'Layer 4', 'Layer 5'];
  const maxLayer = Math.max(0, ...nodes.map((n) => n.layer));

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-elevated overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-border-subtle">
        <h3 className="text-sm font-bold text-content-primary">
          Unified Lineage Graph
        </h3>
        <p className="text-xs text-content-muted mt-0.5">
          Hover a failing table to see its root cause turn red.
          Root-cause badges show how many incidents each table causes.
        </p>
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="overflow-x-auto">
        <div className="relative" style={{ width: canvasW, height: canvasH, minWidth: '100%' }}>

          {/* Layer column labels */}
          {Array.from({ length: maxLayer + 1 }).map((_, i) => (
            <div
              key={`lbl-${i}`}
              className="absolute text-[10px] font-semibold text-content-faint uppercase tracking-wider"
              style={{
                left: PAD_X + i * (NODE_W + LAYER_GAP),
                top: 10,
                width: NODE_W,
                textAlign: 'center',
              }}
            >
              {layerLabels[i] ?? `Layer ${i}`}
            </div>
          ))}

          {/* SVG edge layer */}
          <svg
            className="absolute inset-0 pointer-events-none"
            width={canvasW}
            height={canvasH}
          >
            <defs>
              <marker id="arr-n" viewBox="0 0 10 8" refX="10" refY="4" markerWidth="7" markerHeight="5" orient="auto-start-reverse">
                <path d="M0,0 L10,4 L0,8 Z" className="fill-content-faint" opacity={0.5} />
              </marker>
              <marker id="arr-hl" viewBox="0 0 10 8" refX="10" refY="4" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,4 L0,8 Z" className="fill-danger" />
              </marker>
              <marker id="arr-dim" viewBox="0 0 10 8" refX="10" refY="4" markerWidth="7" markerHeight="5" orient="auto-start-reverse">
                <path d="M0,0 L10,4 L0,8 Z" className="fill-border-strong" opacity={0.2} />
              </marker>
            </defs>

            {edges.map((e) => {
              const fp = positions.get(e.from);
              const tp = positions.get(e.to);
              if (!fp || !tp) return null;

              const key = `${e.from}→${e.to}`;
              const isHL = highlightedEdges.has(key);
              const isDim = hoveredFqn !== null && !isHL;

              const x1 = fp.x + NODE_W;
              const y1 = fp.y + NODE_H / 2;
              const x2 = tp.x;
              const y2 = tp.y + NODE_H / 2;
              const dx = Math.abs(x2 - x1) * 0.45;

              return (
                <path
                  key={key}
                  d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`}
                  fill="none"
                  strokeWidth={isHL ? 2.5 : 1.5}
                  className={
                    isHL
                      ? 'stroke-danger'
                      : isDim
                        ? 'stroke-border-strong opacity-15'
                        : 'stroke-content-faint opacity-40'
                  }
                  markerEnd={isHL ? 'url(#arr-hl)' : isDim ? 'url(#arr-dim)' : 'url(#arr-n)'}
                  style={{ transition: 'all 0.2s ease' }}
                />
              );
            })}
          </svg>

          {/* Nodes */}
          {nodes.map((node) => {
            const pos = positions.get(node.fqn);
            if (!pos) return null;

            const isFailing = node.failingIncidents.length > 0;
            const isRootCause = node.rootCauseFor.length > 0;
            const isHov = hoveredFqn === node.fqn;
            const isHL = highlighted.has(node.fqn);
            const isDim = hoveredFqn !== null && !isHov && !isHL;

            let cls: string;
            if (isHL) {
              cls = 'bg-danger/20 border-danger/60 ring-2 ring-danger/30 shadow-glow scale-105';
            } else if (isHov) {
              cls = isFailing
                ? 'bg-warning/30 border-warning ring-2 ring-warning/40 shadow-glow scale-105'
                : isRootCause
                  ? 'bg-primary-500/20 border-primary-500/60 ring-2 ring-primary-500/30 shadow-glow scale-105'
                  : 'bg-surface-soft border-content-primary/50 ring-2 ring-content-primary/20 scale-105';
            } else if (isDim) {
              cls = 'bg-surface-soft/50 border-border-subtle/50 opacity-35';
            } else if (isFailing) {
              cls = 'bg-warning/15 border-warning/50 hover:border-warning';
            } else if (isRootCause) {
              cls = 'bg-primary-500/10 border-primary-500/30 hover:border-primary-500/50';
            } else {
              cls = 'bg-surface-soft border-border-subtle hover:border-border-strong';
            }

            const tips: string[] = [];
            if (isFailing) {
              tips.push(`⚠ DQ Fail: ${node.failingIncidents.map((id) => node.incidentTitles[id]).join(', ')}`);
            }
            if (isRootCause) {
              tips.push(`🔴 Root cause for: ${node.rootCauseFor.map((id) => {
                const col = node.rootCauseColumns[id];
                const t = node.incidentTitles[id];
                return col ? `${t} (${col})` : t;
              }).join(', ')}`);
            }

            return (
              <a
                key={node.fqn}
                href={`${omBaseUrl}/table/${node.fqn}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`absolute border rounded-xl flex flex-col items-center justify-center transition-all duration-200 cursor-pointer z-10 ${cls}`}
                style={{ left: pos.x, top: pos.y, width: NODE_W, height: NODE_H }}
                title={tips.join('\n')}
                onMouseEnter={() => handleMouseEnter(node.fqn)}
                onMouseLeave={handleMouseLeave}
              >
                {isRootCause && (
                  <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-primary-500 text-white text-[10px] font-bold flex items-center justify-center shadow-md border-2 border-surface-elevated z-20">
                    {node.rootCauseFor.length}
                  </span>
                )}
                {isFailing && !isRootCause && (
                  <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-warning text-surface-base text-[10px] font-bold flex items-center justify-center shadow-md border-2 border-surface-elevated z-20">
                    !
                  </span>
                )}

                <p className="text-xs font-semibold text-content-primary leading-tight">{node.name}</p>

                {(isHL || isHov) && isRootCause && Object.keys(node.rootCauseColumns).length > 0 && (
                  <p className="text-[9px] text-danger font-medium mt-0.5 leading-tight">
                    ⚠ {[...new Set(Object.values(node.rootCauseColumns))].join(', ')}
                  </p>
                )}

                {node.tier && !(isHL || isHov) && (
                  <span className="text-[9px] px-1 py-px mt-0.5 bg-primary-500/10 text-primary-400 border border-primary-500/20 rounded">
                    {node.tier.replace('Tier.', '')}
                  </span>
                )}
              </a>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="px-5 py-2.5 border-t border-border-subtle flex flex-wrap justify-center gap-5 text-xs text-content-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-surface-soft border border-border-subtle" />
          Normal
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-warning/25 border border-warning/50" />
          DQ Failure
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-danger/25 border border-danger/50" />
          Root Cause (on hover)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-primary-500/20 border border-primary-500/40" />
          Root Cause Badge
        </span>
      </div>
    </div>
  );
}

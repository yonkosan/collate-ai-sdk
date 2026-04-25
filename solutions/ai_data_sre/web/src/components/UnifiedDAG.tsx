import { useCallback, useMemo, useRef, useState } from 'react';
import type { IncidentDetail, BlastRadius } from '../types';

/*
 * UnifiedDAG — one single lineage graph merging all active incidents.
 *
 * Every table from every incident becomes a node. Edges follow the actual
 * lineage connections from the blast_radius data. The graph can branch
 * freely — no forced layers, no fake categories.
 *
 * Layout: left-to-right topological ordering with SVG bezier edges.
 */

interface Props {
  details: IncidentDetail[];
  omBaseUrl: string;
}

interface DAGNode {
  fqn: string;
  name: string;
  failingIncidents: string[];   // incident IDs where DQ tests fail on this table
  rootCauseFor: string[];       // incident IDs where this table is root cause
  incidentTitles: Record<string, string>;
  rootCauseColumns: Record<string, string>;
  tier: string | null;
  owners: string[];
  layer: number;                // topological column (0 = leftmost)
  row: number;                  // vertical position within column
}

interface DAGEdge { from: string; to: string }

/* ── Layout ──────────────────────────────────────────────────────────────── */

const NODE_W = 168;
const NODE_H = 60;
const GAP_X = 80;   // horizontal space between columns
const GAP_Y = 28;   // vertical space between rows
const PAD = 24;      // canvas padding

/* ── Build graph from blast_radius data ──────────────────────────────────── */

function buildDAG(details: IncidentDetail[]): { nodes: DAGNode[]; edges: DAGEdge[] } {
  const nodeMap = new Map<string, DAGNode>();
  const edgeSet = new Set<string>();
  const edges: DAGEdge[] = [];

  const getOrCreate = (fqn: string): DAGNode => {
    let n = nodeMap.get(fqn);
    if (!n) {
      n = {
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
      nodeMap.set(fqn, n);
    }
    return n;
  };

  const addEdge = (from: string, to: string) => {
    if (from === to) return;
    const key = `${from}→${to}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ from, to });
  };

  for (const detail of details) {
    const br: BlastRadius | null = detail.blast_radius;
    if (!br) continue;

    // Mark failing table
    const failFqn = detail.failures?.[0]?.table_fqn;
    if (failFqn) {
      const failNode = getOrCreate(failFqn);
      if (!failNode.failingIncidents.includes(detail.id)) {
        failNode.failingIncidents.push(detail.id);
        failNode.incidentTitles[detail.id] = detail.title;
      }
    }

    // Mark root cause
    const rootNode = getOrCreate(br.root_cause_table);
    if (!rootNode.rootCauseFor.includes(detail.id)) {
      rootNode.rootCauseFor.push(detail.id);
      rootNode.incidentTitles[detail.id] = detail.title;
    }
    if (br.root_cause_column) {
      rootNode.rootCauseColumns[detail.id] = br.root_cause_column;
    }

    // Build edges from downstream_impact — this is the most reliable source.
    // downstream_impact gives us assets ordered by depth FROM the root cause.
    // We chain: root_cause → depth1 → depth2 → depth3 …
    const depthBuckets = new Map<number, string[]>();
    for (const asset of br.downstream_impact) {
      const node = getOrCreate(asset.fqn);
      if (asset.tier && !node.tier) node.tier = asset.tier;
      if (asset.owners?.length && !node.owners.length) node.owners = asset.owners;
      const bucket = depthBuckets.get(asset.depth) ?? [];
      bucket.push(asset.fqn);
      depthBuckets.set(asset.depth, bucket);
    }

    // Root cause connects to all depth-1 nodes
    const depth1 = depthBuckets.get(1) ?? [];
    for (const fqn of depth1) {
      addEdge(br.root_cause_table, fqn);
    }
    // Each depth-N connects to depth-(N+1)
    const maxDepth = Math.max(0, ...depthBuckets.keys());
    for (let d = 1; d < maxDepth; d++) {
      const current = depthBuckets.get(d) ?? [];
      const next = depthBuckets.get(d + 1) ?? [];
      for (const from of current) {
        for (const to of next) {
          addEdge(from, to);
        }
      }
    }

    // Also process upstream_chain for metadata (tier, owners)
    for (const asset of br.upstream_chain) {
      const node = getOrCreate(asset.fqn);
      if (asset.tier && !node.tier) node.tier = asset.tier;
      if (asset.owners?.length && !node.owners.length) node.owners = asset.owners;
    }
  }

  // ── Topological layering (longest-path from roots) ──
  const adjOut = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const fqn of nodeMap.keys()) {
    adjOut.set(fqn, []);
    inDeg.set(fqn, 0);
  }
  for (const e of edges) {
    adjOut.get(e.from)!.push(e.to);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [fqn, deg] of inDeg) {
    if (deg === 0) queue.push(fqn);
  }
  while (queue.length > 0) {
    const fqn = queue.shift()!;
    const node = nodeMap.get(fqn)!;
    for (const next of adjOut.get(fqn)!) {
      const nn = nodeMap.get(next)!;
      nn.layer = Math.max(nn.layer, node.layer + 1);
      const nd = (inDeg.get(next) ?? 1) - 1;
      inDeg.set(next, nd);
      if (nd === 0) queue.push(next);
    }
  }

  // ── Row assignment within each column ──
  const cols = new Map<number, DAGNode[]>();
  for (const n of nodeMap.values()) {
    const arr = cols.get(n.layer) ?? [];
    arr.push(n);
    cols.set(n.layer, arr);
  }
  for (const [, colNodes] of cols) {
    colNodes.sort((a, b) => a.name.localeCompare(b.name));
    colNodes.forEach((n, i) => { n.row = i; });
  }

  return { nodes: Array.from(nodeMap.values()), edges };
}

/* ── Component ───────────────────────────────────────────────────────────── */

export function UnifiedDAG({ details, omBaseUrl }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const { nodes, edges } = useMemo(() => buildDAG(details), [details]);

  // Compute positions for every node
  const { positions, canvasW, canvasH } = useMemo(() => {
    const colSizes = new Map<number, number>();
    let maxCol = 0;
    for (const n of nodes) {
      colSizes.set(n.layer, (colSizes.get(n.layer) ?? 0) + 1);
      maxCol = Math.max(maxCol, n.layer);
    }

    const maxRows = Math.max(1, ...colSizes.values());
    const totalH = maxRows * NODE_H + (maxRows - 1) * GAP_Y;
    const w = PAD * 2 + (maxCol + 1) * NODE_W + maxCol * GAP_X;
    const h = PAD * 2 + totalH;

    const pos = new Map<string, { x: number; y: number }>();
    for (const n of nodes) {
      const colSize = colSizes.get(n.layer) ?? 1;
      const colH = colSize * NODE_H + (colSize - 1) * GAP_Y;
      const offsetY = (totalH - colH) / 2; // center column vertically
      pos.set(n.fqn, {
        x: PAD + n.layer * (NODE_W + GAP_X),
        y: PAD + offsetY + n.row * (NODE_H + GAP_Y),
      });
    }

    return { positions: pos, canvasW: w, canvasH: h };
  }, [nodes]);

  // On hover: collect related nodes (root causes ↔ failing tables)
  const related = useMemo<Set<string>>(() => {
    if (!hovered) return new Set();
    const hn = nodes.find((n) => n.fqn === hovered);
    if (!hn) return new Set();

    const out = new Set<string>();
    // If hovering a failing table → highlight its root causes
    for (const incId of hn.failingIncidents) {
      for (const n of nodes) {
        if (n.rootCauseFor.includes(incId)) out.add(n.fqn);
      }
    }
    // If hovering a root cause → highlight its failing tables
    for (const incId of hn.rootCauseFor) {
      for (const n of nodes) {
        if (n.failingIncidents.includes(incId)) out.add(n.fqn);
      }
    }
    return out;
  }, [hovered, nodes]);

  // Highlight edges on paths between hovered node and related nodes
  const hlEdges = useMemo<Set<string>>(() => {
    if (!hovered || related.size === 0) return new Set();
    const group = new Set([hovered, ...related]);

    // Build forward adjacency
    const fwd = new Map<string, string[]>();
    for (const e of edges) {
      const a = fwd.get(e.from) ?? [];
      a.push(e.to);
      fwd.set(e.from, a);
    }

    const result = new Set<string>();
    for (const src of group) {
      const parent = new Map<string, string | null>();
      parent.set(src, null);
      const q = [src];
      while (q.length > 0) {
        const cur = q.shift()!;
        for (const nxt of fwd.get(cur) ?? []) {
          if (!parent.has(nxt)) { parent.set(nxt, cur); q.push(nxt); }
        }
      }
      for (const tgt of group) {
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
  }, [hovered, related, edges]);

  const onEnter = useCallback((fqn: string) => setHovered(fqn), []);
  const onLeave = useCallback(() => setHovered(null), []);

  if (nodes.length === 0) return null;

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-elevated overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-border-subtle flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-content-primary">Unified Lineage</h3>
          <p className="text-xs text-content-muted mt-0.5">
            Hover any table to trace the incident path. Root-cause badges show incident count.
          </p>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-content-muted">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-warning/40 border border-warning/60" />
            DQ Failure
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-danger/40 border border-danger/60" />
            Root Cause
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-surface-soft border border-border-subtle" />
            Passthrough
          </span>
        </div>
      </div>

      {/* Canvas */}
      <div ref={ref} className="overflow-x-auto p-2">
        <div
          className="relative mx-auto"
          style={{ width: canvasW, height: canvasH, minWidth: '100%' }}
        >
          {/* SVG edges */}
          <svg className="absolute inset-0 pointer-events-none" width={canvasW} height={canvasH}>
            <defs>
              <marker id="ah" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="7" markerHeight="5" orient="auto-start-reverse">
                <path d="M0,0 L10,4 L0,8 Z" fill="var(--color-content-faint)" opacity="0.6" />
              </marker>
              <marker id="ah-hl" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,4 L0,8 Z" fill="var(--color-danger)" />
              </marker>
            </defs>
            {edges.map((e) => {
              const fp = positions.get(e.from);
              const tp = positions.get(e.to);
              if (!fp || !tp) return null;

              const key = `${e.from}→${e.to}`;
              const hl = hlEdges.has(key);
              const dim = hovered !== null && !hl;

              const x1 = fp.x + NODE_W;
              const y1 = fp.y + NODE_H / 2;
              const x2 = tp.x;
              const y2 = tp.y + NODE_H / 2;
              const cx = Math.abs(x2 - x1) * 0.4;

              return (
                <path
                  key={key}
                  d={`M${x1},${y1} C${x1 + cx},${y1} ${x2 - cx},${y2} ${x2},${y2}`}
                  fill="none"
                  stroke={hl ? 'var(--color-danger)' : 'var(--color-content-faint)'}
                  strokeWidth={hl ? 2.5 : 1.5}
                  opacity={dim ? 0.12 : hl ? 1 : 0.45}
                  markerEnd={hl ? 'url(#ah-hl)' : 'url(#ah)'}
                  style={{ transition: 'all 0.2s' }}
                />
              );
            })}
          </svg>

          {/* Nodes */}
          {nodes.map((node) => {
            const pos = positions.get(node.fqn);
            if (!pos) return null;

            const isFail = node.failingIncidents.length > 0;
            const isRoot = node.rootCauseFor.length > 0;
            const isHov = hovered === node.fqn;
            const isRel = related.has(node.fqn);
            const dim = hovered !== null && !isHov && !isRel;

            // Visual state
            let border: string;
            let bg: string;
            let extra = '';

            if (isRel) {
              // Related node highlighted on hover
              border = 'border-danger/70';
              bg = 'bg-danger/15';
              extra = 'ring-2 ring-danger/30 scale-[1.03]';
            } else if (isHov) {
              border = isFail ? 'border-warning' : isRoot ? 'border-primary-500/70' : 'border-content-secondary';
              bg = isFail ? 'bg-warning/25' : isRoot ? 'bg-primary-500/15' : 'bg-surface-soft';
              extra = 'ring-2 ring-white/10 scale-[1.03] shadow-glow';
            } else if (dim) {
              border = 'border-border-subtle/40';
              bg = 'bg-surface-soft/40';
              extra = 'opacity-30';
            } else if (isFail) {
              border = 'border-warning/50';
              bg = 'bg-warning/10';
              extra = 'hover:border-warning/70';
            } else if (isRoot) {
              border = 'border-primary-500/40';
              bg = 'bg-primary-500/8';
              extra = 'hover:border-primary-500/60';
            } else {
              border = 'border-border-subtle';
              bg = 'bg-surface-soft';
              extra = 'hover:border-border-strong';
            }

            // Tooltip
            const tips: string[] = [];
            if (isFail) {
              tips.push(`⚠ DQ failures: ${node.failingIncidents.map((id) => node.incidentTitles[id]).join(', ')}`);
            }
            if (isRoot) {
              const items = node.rootCauseFor.map((id) => {
                const col = node.rootCauseColumns[id];
                const t = node.incidentTitles[id];
                return col ? `${t} (col: ${col})` : t;
              });
              tips.push(`🔴 Root cause for: ${items.join(', ')}`);
            }

            return (
              <a
                key={node.fqn}
                href={`${omBaseUrl}/table/${node.fqn}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`absolute z-10 rounded-xl border flex flex-col items-center justify-center cursor-pointer transition-all duration-200 ${border} ${bg} ${extra}`}
                style={{ left: pos.x, top: pos.y, width: NODE_W, height: NODE_H }}
                title={tips.join('\n')}
                onMouseEnter={() => onEnter(node.fqn)}
                onMouseLeave={onLeave}
              >
                {/* Root-cause badge */}
                {isRoot && (
                  <span className="absolute -top-2 -right-2 z-20 w-5 h-5 rounded-full bg-primary-500 text-white text-[10px] font-bold flex items-center justify-center shadow border-2 border-surface-elevated">
                    {node.rootCauseFor.length}
                  </span>
                )}
                {/* Failing badge */}
                {isFail && !isRoot && (
                  <span className="absolute -top-2 -right-2 z-20 w-5 h-5 rounded-full bg-warning text-surface-base text-[10px] font-bold flex items-center justify-center shadow border-2 border-surface-elevated">
                    !
                  </span>
                )}

                {/* Table name */}
                <span className="text-xs font-semibold text-content-primary leading-tight text-center px-2">
                  {node.name}
                </span>

                {/* Root-cause column shown on hover/highlight */}
                {(isRel || isHov) && isRoot && Object.keys(node.rootCauseColumns).length > 0 && (
                  <span className="text-[9px] text-danger font-medium mt-0.5 leading-tight">
                    ⚠ {[...new Set(Object.values(node.rootCauseColumns))].join(', ')}
                  </span>
                )}

                {/* Tier when no column info showing */}
                {node.tier && !(isRel || isHov) && (
                  <span className="text-[9px] px-1.5 py-px mt-0.5 bg-primary-500/10 text-primary-400 border border-primary-500/20 rounded">
                    {node.tier.replace('Tier.', '')}
                  </span>
                )}
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}

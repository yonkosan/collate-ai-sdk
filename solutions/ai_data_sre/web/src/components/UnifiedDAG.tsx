import { useCallback, useMemo, useState } from 'react';
import type { IncidentDetail, BlastRadius } from '../types';

/* ──────────────────────────────────────────────────────────────────────────
 *  UnifiedDAG — a single lineage graph built from ALL active incidents.
 *
 *  • Every table that appears in any incident's blast radius is a node.
 *  • Edges come from upstream_chain/downstream_impact relationships.
 *  • Tables where a DQ test failed are amber.
 *  • On hover over a failing table → its root-cause tables turn red and
 *    the path between them is highlighted, so engineers can see at a glance
 *    if one table is the root cause for multiple failures.
 *  • Root-cause tables always show a small badge counting how many
 *    incidents they are responsible for.
 * ────────────────────────────────────────────────────────────────────────── */

interface Props {
  details: IncidentDetail[];
  omBaseUrl: string;
}

/* ── Internal types ─────────────────────────────────────────────────────── */

interface DAGNode {
  fqn: string;
  name: string;
  /** Incident IDs where this table has a DQ failure */
  failingIncidents: string[];
  /** Incident IDs where this table is the root cause */
  rootCauseFor: string[];
  /** Incident titles for tooltip (keyed by incident ID) */
  incidentTitles: Record<string, string>;
  /** Column responsible per incident */
  rootCauseColumns: Record<string, string>;
  tier: string | null;
  owners: string[];
  layer: number;
}

interface DAGEdge {
  from: string; // fqn
  to: string;   // fqn
}

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
      };
      nodeMap.set(fqn, node);
    }
    if (tier && !node.tier) node.tier = tier;
    if (owners?.length && !node.owners.length) node.owners = owners;
    return node;
  };

  const addEdge = (from: string, to: string) => {
    const key = `${from}→${to}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push({ from, to });
    }
  };

  for (const detail of details) {
    const br: BlastRadius | null = detail.blast_radius;
    if (!br) continue;

    // The table where the test failed (the start table of the incident)
    const failTableFqn = detail.failures?.[0]?.table_fqn;
    if (failTableFqn) {
      const failNode = ensureNode(failTableFqn);
      if (!failNode.failingIncidents.includes(detail.id)) {
        failNode.failingIncidents.push(detail.id);
      }
      failNode.incidentTitles[detail.id] = detail.title;
    }

    // Root cause table
    const rootNode = ensureNode(br.root_cause_table);
    if (!rootNode.rootCauseFor.includes(detail.id)) {
      rootNode.rootCauseFor.push(detail.id);
    }
    rootNode.incidentTitles[detail.id] = detail.title;
    if (br.root_cause_column) {
      rootNode.rootCauseColumns[detail.id] = br.root_cause_column;
    }

    // Upstream chain: root_cause → ... → upstream[0] → failTable
    // The chain is ordered from closest-to-fail to farthest (root cause excluded)
    const upstreamFqns = br.upstream_chain.map((a) => a.fqn);
    // Build edges: root_cause → last_upstream → ... → first_upstream → failTable
    const fullPath = [br.root_cause_table, ...upstreamFqns.reverse()];
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

    // Upstream nodes — register metadata
    for (const asset of br.upstream_chain) {
      ensureNode(asset.fqn, asset.tier, asset.owners);
    }

    // Downstream impact: failTable → downstream[0] → downstream[1] → ...
    let prevFqn = failTableFqn ?? br.root_cause_table;
    for (const asset of br.downstream_impact) {
      const n = ensureNode(asset.fqn, asset.tier, asset.owners);
      addEdge(prevFqn, n.fqn);
      // For deeper downstream, chain by depth
      if (asset.depth > 1) {
        // find prev at depth-1
        const prevAtDepth = br.downstream_impact.find(
          (a) => a.depth === asset.depth - 1
        );
        if (prevAtDepth) {
          addEdge(prevAtDepth.fqn, asset.fqn);
        }
      }
      prevFqn = n.fqn;
    }
  }

  // Assign layers via topological sort (longest path from source)
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

  // Kahn's algorithm for layering
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

  const nodes = Array.from(nodeMap.values());
  return { nodes, edges };
}

/* ── Component ──────────────────────────────────────────────────────────── */

export function UnifiedDAG({ details, omBaseUrl }: Props) {
  const [hoveredFqn, setHoveredFqn] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => buildDAG(details), [details]);

  // Group nodes by layer for rendering
  const layers = useMemo(() => {
    const map = new Map<number, DAGNode[]>();
    for (const node of nodes) {
      const arr = map.get(node.layer) ?? [];
      arr.push(node);
      map.set(node.layer, arr);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .map(([, layerNodes]) => layerNodes);
  }, [nodes]);

  // When hovering a DQ-failing table, compute which tables to highlight red
  const highlighted = useMemo<Set<string>>(() => {
    if (!hoveredFqn) return new Set();
    const hoveredNode = nodes.find((n) => n.fqn === hoveredFqn);
    if (!hoveredNode) return new Set();

    const set = new Set<string>();

    // If hovering a failing table: highlight its root-cause tables
    if (hoveredNode.failingIncidents.length > 0) {
      for (const incidentId of hoveredNode.failingIncidents) {
        for (const node of nodes) {
          if (node.rootCauseFor.includes(incidentId)) {
            set.add(node.fqn);
          }
        }
      }
    }

    // If hovering a root-cause table: highlight the tables it causes to fail
    if (hoveredNode.rootCauseFor.length > 0) {
      for (const incidentId of hoveredNode.rootCauseFor) {
        for (const node of nodes) {
          if (node.failingIncidents.includes(incidentId)) {
            set.add(node.fqn);
          }
        }
      }
    }

    return set;
  }, [hoveredFqn, nodes]);

  // Highlighted edges: all edges on paths between hovered and highlighted nodes
  const highlightedEdges = useMemo<Set<string>>(() => {
    if (!hoveredFqn || highlighted.size === 0) return new Set();

    // BFS/DFS to find edges on paths between root causes and failing tables
    const relevantNodes = new Set([hoveredFqn, ...highlighted]);

    // Build adjacency in both directions
    const adjFwd = new Map<string, string[]>();
    const adjRev = new Map<string, string[]>();
    for (const e of edges) {
      const fwd = adjFwd.get(e.from) ?? [];
      fwd.push(e.to);
      adjFwd.set(e.from, fwd);
      const rev = adjRev.get(e.to) ?? [];
      rev.push(e.from);
      adjRev.set(e.to, rev);
    }

    // Find all nodes reachable between relevant nodes
    const edgesOnPath = new Set<string>();
    for (const src of relevantNodes) {
      // BFS forward from each relevant node
      const visited = new Set<string>();
      const q = [src];
      visited.add(src);
      while (q.length > 0) {
        const cur = q.shift()!;
        for (const next of adjFwd.get(cur) ?? []) {
          if (!visited.has(next)) {
            visited.add(next);
            q.push(next);
            // If this reaches another relevant node, mark the entire path
            if (relevantNodes.has(next)) {
              edgesOnPath.add(`${cur}→${next}`);
            }
          }
          edgesOnPath.add(`${cur}→${next}`);
        }
      }
    }

    // Filter to only edges where both endpoints are reachable from relevant nodes
    const reachableFromRelevant = new Set<string>();
    for (const src of relevantNodes) {
      const visited = new Set<string>();
      const q = [src];
      visited.add(src);
      while (q.length > 0) {
        const cur = q.shift()!;
        reachableFromRelevant.add(cur);
        for (const next of adjFwd.get(cur) ?? []) {
          if (!visited.has(next)) { visited.add(next); q.push(next); }
        }
        for (const prev of adjRev.get(cur) ?? []) {
          if (!visited.has(prev)) { visited.add(prev); q.push(prev); }
        }
      }
    }

    const result = new Set<string>();
    for (const e of edges) {
      if (reachableFromRelevant.has(e.from) && reachableFromRelevant.has(e.to)) {
        if (relevantNodes.has(e.from) || relevantNodes.has(e.to)) {
          result.add(`${e.from}→${e.to}`);
        }
      }
    }
    return result;
  }, [hoveredFqn, highlighted, edges]);

  const handleMouseEnter = useCallback((fqn: string) => setHoveredFqn(fqn), []);
  const handleMouseLeave = useCallback(() => setHoveredFqn(null), []);

  if (nodes.length === 0) return null;

  // Layer labels
  const layerLabels = ['Sources', 'Staging', 'Facts', 'Executive', 'Layer 4', 'Layer 5'];

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-elevated overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-border-subtle">
        <h3 className="text-sm font-bold text-content-primary">
          Unified Lineage Graph
        </h3>
        <p className="text-xs text-content-muted mt-0.5">
          Hover over a failing table to see its root cause highlighted in red.
          Root-cause tables show how many incidents they cause.
        </p>
      </div>

      {/* DAG */}
      <div className="px-4 py-5 overflow-x-auto">
        <div className="flex items-start justify-center gap-3 min-w-max">
          {layers.map((layerNodes, layerIdx) => (
            <div key={layerIdx} className="flex flex-col items-center gap-2">
              {/* Layer label */}
              <span className="text-[10px] font-medium text-content-faint uppercase tracking-wider mb-1">
                {layerLabels[layerIdx] ?? `Layer ${layerIdx}`}
              </span>

              {/* Nodes in this layer */}
              {layerNodes.map((node) => (
                <div key={node.fqn} className="flex items-center gap-2">
                  {/* Arrow from previous layer */}
                  {layerIdx > 0 && <LayerArrow highlighted={
                    edges.some(
                      (e) =>
                        e.to === node.fqn &&
                        highlightedEdges.has(`${e.from}→${e.to}`)
                    )
                  } />}

                  <DAGNodeBox
                    node={node}
                    omBaseUrl={omBaseUrl}
                    isHovered={hoveredFqn === node.fqn}
                    isHighlighted={highlighted.has(node.fqn)}
                    isDimmed={hoveredFqn !== null && hoveredFqn !== node.fqn && !highlighted.has(node.fqn)}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                  />
                </div>
              ))}
            </div>
          ))}
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

/* ── Node box ───────────────────────────────────────────────────────────── */

function DAGNodeBox({
  node,
  omBaseUrl,
  isHovered,
  isHighlighted,
  isDimmed,
  onMouseEnter,
  onMouseLeave,
}: {
  node: DAGNode;
  omBaseUrl: string;
  isHovered: boolean;
  isHighlighted: boolean;
  isDimmed: boolean;
  onMouseEnter: (fqn: string) => void;
  onMouseLeave: () => void;
}) {
  const isFailing = node.failingIncidents.length > 0;
  const isRootCause = node.rootCauseFor.length > 0;

  // Determine style
  let style: string;
  if (isHighlighted) {
    // Highlighted red when hovered node reveals this as root cause / affected
    style = 'bg-danger/20 border-danger/60 ring-2 ring-danger/30 shadow-glow scale-105';
  } else if (isHovered) {
    // The table being hovered
    style = isFailing
      ? 'bg-warning/30 border-warning ring-2 ring-warning/40 shadow-glow scale-105'
      : isRootCause
        ? 'bg-primary-500/20 border-primary-500/60 ring-2 ring-primary-500/30 shadow-glow scale-105'
        : 'bg-surface-soft border-content-primary/50 ring-2 ring-content-primary/20 scale-105';
  } else if (isDimmed) {
    style = 'bg-surface-soft/50 border-border-subtle/50 opacity-40';
  } else if (isFailing) {
    // Default: DQ failure table
    style = 'bg-warning/15 border-warning/50 hover:border-warning';
  } else if (isRootCause) {
    // Default: root cause table (subtle indicator)
    style = 'bg-primary-500/10 border-primary-500/30 hover:border-primary-500/50';
  } else {
    // Normal table
    style = 'bg-surface-soft border-border-subtle hover:border-border-strong';
  }

  // Tooltip lines
  const tooltipLines: string[] = [];
  if (isFailing) {
    tooltipLines.push(`⚠ DQ Fail: ${node.failingIncidents.map((id) => node.incidentTitles[id]).join(', ')}`);
  }
  if (isRootCause) {
    const entries = node.rootCauseFor.map((id) => {
      const col = node.rootCauseColumns[id];
      const title = node.incidentTitles[id];
      return col ? `${title} (${col})` : title;
    });
    tooltipLines.push(`🔴 Root cause for: ${entries.join(', ')}`);
  }

  return (
    <a
      href={`${omBaseUrl}/table/${node.fqn}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`relative block border rounded-xl px-3 py-2.5 min-w-[130px] text-center transition-all duration-200 cursor-pointer ${style}`}
      title={tooltipLines.join('\n')}
      onMouseEnter={() => onMouseEnter(node.fqn)}
      onMouseLeave={onMouseLeave}
    >
      {/* Root cause badge */}
      {isRootCause && (
        <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-primary-500 text-white text-[10px] font-bold flex items-center justify-center shadow-md border-2 border-surface-elevated">
          {node.rootCauseFor.length}
        </span>
      )}

      {/* Failing badge */}
      {isFailing && !isRootCause && (
        <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-warning text-surface-base text-[10px] font-bold flex items-center justify-center shadow-md border-2 border-surface-elevated">
          !
        </span>
      )}

      <p className="text-sm font-semibold text-content-primary">{node.name}</p>

      {/* Show root cause columns on hover/highlight */}
      {(isHighlighted || isHovered) && isRootCause && (
        <div className="mt-1 space-y-0.5">
          {Object.entries(node.rootCauseColumns).map(([incId, col]) => (
            <p key={incId} className="text-[10px] text-danger font-medium">
              ⚠ {col}
            </p>
          ))}
        </div>
      )}

      {node.tier && (
        <span className="inline-block text-[10px] px-1.5 py-0.5 mt-1 bg-primary-500/10 text-primary-400 border border-primary-500/20 rounded-lg">
          {node.tier.replace('Tier.', '')}
        </span>
      )}
      {node.owners.length > 0 && (
        <p className="text-[10px] text-content-muted mt-0.5 truncate max-w-[120px]">
          {node.owners.join(', ')}
        </p>
      )}
    </a>
  );
}

/* ── Arrow between layers ───────────────────────────────────────────────── */

function LayerArrow({ highlighted }: { highlighted: boolean }) {
  return (
    <div className={`flex items-center transition-all duration-200 ${highlighted ? 'opacity-100' : 'opacity-40'}`}>
      <div className={`w-6 h-px ${highlighted ? 'bg-danger' : 'bg-border-strong'}`} />
      <svg viewBox="0 0 8 12" className={`w-2 h-3 ${highlighted ? 'fill-danger' : 'fill-content-faint'}`}>
        <polygon points="0,0 8,6 0,12" />
      </svg>
    </div>
  );
}

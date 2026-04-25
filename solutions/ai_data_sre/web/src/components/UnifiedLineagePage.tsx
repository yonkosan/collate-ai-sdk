import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Database,
  GitBranch,
  Loader2,
  RefreshCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { api } from '../api';
import type { AffectedAsset, BlastRadius, IncidentDetail, IncidentSummary } from '../types';
import { SEVERITY_CONFIG, DEFAULT_SEVERITY_CONFIG } from '../data/constants';

/* ─── Node model for the unified graph ───────────────────────────────── */

type NodeRole = 'root' | 'upstream' | 'downstream';

interface GraphNode {
  fqn: string;
  name: string;
  tier: string | null;
  owners: string[];
  roles: Set<NodeRole>;
  /** incident IDs that touch this node */
  incidentIds: Set<string>;
  /** severities of incidents touching this node */
  severities: Set<string>;
  /** depth from root cause (negative = upstream, positive = downstream, 0 = root) */
  depth: number;
}

interface GraphEdge {
  from: string;
  to: string;
}

interface Props {
  incidents: IncidentSummary[];
}

export function UnifiedLineagePage({ incidents }: Props) {
  const [details, setDetails] = useState<IncidentDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [omBaseUrl, setOmBaseUrl] = useState('http://localhost:8585');
  const [zoom, setZoom] = useState(1);

  const activeIncidents = useMemo(
    () => incidents.filter((i) => i.status !== 'resolved'),
    [incidents]
  );

  const fetchAllDetails = useCallback(async () => {
    if (activeIncidents.length === 0) return;
    setLoading(true);
    try {
      const [config, ...fetched] = await Promise.all([
        api.getConfig(),
        ...activeIncidents.map((i) => api.getIncident(i.id)),
      ]);
      setOmBaseUrl(config.om_base_url);
      setDetails(fetched);
    } catch {
      /* best effort */
    } finally {
      setLoading(false);
    }
  }, [activeIncidents]);

  useEffect(() => {
    fetchAllDetails();
  }, [fetchAllDetails]);

  /* ─── Build unified graph ─────────────────────────────────────────── */

  const { nodes, edges, columns } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>();
    const edgeSet = new Set<string>();
    const edgeList: GraphEdge[] = [];

    function getOrCreate(fqn: string, asset?: AffectedAsset): GraphNode {
      let node = nodeMap.get(fqn);
      if (!node) {
        node = {
          fqn,
          name: fqn.split('.').pop() ?? fqn,
          tier: asset?.tier ?? null,
          owners: asset?.owners ?? [],
          roles: new Set(),
          incidentIds: new Set(),
          severities: new Set(),
          depth: 0,
        };
        nodeMap.set(fqn, node);
      }
      if (asset?.tier && !node.tier) node.tier = asset.tier;
      if (asset?.owners) {
        for (const o of asset.owners) {
          if (!node.owners.includes(o)) node.owners.push(o);
        }
      }
      return node;
    }

    function addEdge(from: string, to: string) {
      const key = `${from}→${to}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edgeList.push({ from, to });
      }
    }

    for (const detail of details) {
      const br = detail.blast_radius;
      if (!br) continue;

      // Root node
      const rootNode = getOrCreate(br.root_cause_table);
      rootNode.roles.add('root');
      rootNode.incidentIds.add(detail.id);
      rootNode.severities.add(detail.severity);
      rootNode.depth = 0;

      // Upstream chain
      let prevFqn = br.root_cause_table;
      for (const asset of [...br.upstream_chain].reverse()) {
        const node = getOrCreate(asset.fqn, asset);
        node.roles.add('upstream');
        node.incidentIds.add(detail.id);
        node.severities.add(detail.severity);
        node.depth = Math.min(node.depth, -asset.depth);
        addEdge(asset.fqn, prevFqn);
        prevFqn = asset.fqn;
      }

      // Downstream impact
      for (const asset of br.downstream_impact) {
        const node = getOrCreate(asset.fqn, asset);
        node.roles.add('downstream');
        node.incidentIds.add(detail.id);
        node.severities.add(detail.severity);
        node.depth = Math.max(node.depth, asset.depth);
        addEdge(br.root_cause_table, asset.fqn);
      }
    }

    // Organize into columns by depth
    const allNodes = Array.from(nodeMap.values());
    const depths = allNodes.map((n) => n.depth);
    const minDepth = Math.min(0, ...depths);
    const maxDepth = Math.max(0, ...depths);

    const cols: GraphNode[][] = [];
    for (let d = minDepth; d <= maxDepth; d++) {
      const col = allNodes
        .filter((n) => n.depth === d)
        .sort((a, b) => {
          // Root nodes first, then by incident count
          if (a.roles.has('root') && !b.roles.has('root')) return -1;
          if (!a.roles.has('root') && b.roles.has('root')) return 1;
          return b.incidentIds.size - a.incidentIds.size;
        });
      if (col.length > 0) cols.push(col);
    }

    return { nodes: allNodes, edges: edgeList, columns: cols };
  }, [details]);

  /* ─── Render ──────────────────────────────────────────────────────── */

  if (activeIncidents.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 mb-4 rounded-2xl bg-success/10 border border-success/30 flex items-center justify-center">
          <GitBranch className="w-8 h-8 text-success" />
        </div>
        <h2 className="text-lg font-bold text-content-primary mb-2">No Active Incidents</h2>
        <p className="text-sm text-content-muted max-w-sm">
          Run the pipeline to detect incidents. Lineage graphs will appear here for all active incidents.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary-400 animate-spin mb-3" />
        <p className="text-sm text-content-muted">Building unified lineage graph…</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-content-primary tracking-tight flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-primary-400" />
            Unified Lineage
          </h2>
          <p className="text-xs text-content-muted mt-1">
            {nodes.length} assets across {activeIncidents.length} active incident{activeIncidents.length !== 1 ? 's' : ''}
            {' · '}{edges.length} lineage edge{edges.length !== 1 ? 's' : ''}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))}
            className="p-1.5 rounded-lg border border-border-subtle text-content-muted hover:text-content-primary hover:bg-surface-soft transition-all"
            aria-label="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs text-content-muted min-w-[3rem] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(1.5, z + 0.15))}
            className="p-1.5 rounded-lg border border-border-subtle text-content-muted hover:text-content-primary hover:bg-surface-soft transition-all"
            aria-label="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={fetchAllDetails}
            className="p-1.5 rounded-lg border border-border-subtle text-content-muted hover:text-content-primary hover:bg-surface-soft transition-all ml-1"
            aria-label="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex-shrink-0 flex flex-wrap items-center gap-4 mb-4 px-3 py-2 bg-surface-elevated border border-border-subtle rounded-xl text-xs text-content-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-secondary-500/30 border border-secondary-500/50" />
          Upstream
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-danger/30 border border-danger/50" />
          Root Cause
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-warning/30 border border-warning/50" />
          Downstream
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-primary-500/30 border-2 border-primary-500/60" />
          Multi-incident
        </span>
      </div>

      {/* Graph — scrollable in both directions */}
      <div className="flex-1 overflow-auto min-h-0 rounded-xl border border-border-subtle bg-surface-elevated/50">
        <div
          className="p-8 min-w-max"
          style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
        >
          {columns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-content-muted">
              <Database className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm">No lineage data available yet.</p>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              {columns.map((col, colIdx) => (
                <div key={colIdx} className="flex items-start gap-3">
                  {/* Column of nodes */}
                  <div className="flex flex-col gap-3">
                    {/* Column header */}
                    <div className="text-center text-xs font-semibold text-content-faint uppercase tracking-wider mb-1">
                      {col[0]!.depth < 0
                        ? `Upstream ${Math.abs(col[0]!.depth)}`
                        : col[0]!.depth === 0
                          ? 'Root Cause'
                          : `Downstream ${col[0]!.depth}`}
                    </div>
                    {col.map((node) => (
                      <LineageNode
                        key={node.fqn}
                        node={node}
                        omBaseUrl={omBaseUrl}
                        incidents={activeIncidents}
                      />
                    ))}
                  </div>

                  {/* Arrow between columns */}
                  {colIdx < columns.length - 1 && (
                    <div className="flex items-center self-center mt-8">
                      <div className="w-10 h-px bg-border-strong" />
                      <svg viewBox="0 0 8 12" className="w-2 h-3 fill-content-faint flex-shrink-0">
                        <polygon points="0,0 8,6 0,12" />
                      </svg>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Lineage Node ──────────────────────────────────────────────────── */

function LineageNode({
  node,
  omBaseUrl,
  incidents,
}: {
  node: GraphNode;
  omBaseUrl: string;
  incidents: IncidentSummary[];
}) {
  const primaryRole: NodeRole = node.roles.has('root')
    ? 'root'
    : node.roles.has('downstream')
      ? 'downstream'
      : 'upstream';

  const isMultiIncident = node.incidentIds.size > 1;

  const styleMap = {
    upstream: 'bg-secondary-500/10 border-secondary-500/40 hover:border-secondary-400',
    root: 'bg-danger/15 border-danger/50 hover:border-danger shadow-glow',
    downstream: 'bg-warning/10 border-warning/40 hover:border-warning',
  };

  const dotColor = {
    upstream: 'bg-secondary-400',
    root: 'bg-danger',
    downstream: 'bg-warning',
  };

  // Find the highest severity for this node
  const highestSeverity = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].find((s) =>
    node.severities.has(s)
  ) ?? 'MEDIUM';
  const sevConfig = SEVERITY_CONFIG[highestSeverity] ?? DEFAULT_SEVERITY_CONFIG;

  // Matching incident summaries
  const matchingIncidents = incidents.filter((i) => node.incidentIds.has(i.id));

  return (
    <a
      href={`${omBaseUrl}/table/${node.fqn}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`group relative block border rounded-xl p-3 min-w-[160px] max-w-[200px] transition-all hover:shadow-card ${styleMap[primaryRole]} ${
        isMultiIncident ? 'ring-2 ring-primary-500/30' : ''
      }`}
    >
      {/* Role indicator dot */}
      <span
        className={`absolute -top-1 -right-1 w-3 h-3 rounded-full ${dotColor[primaryRole]} border-2 border-surface-elevated`}
      />

      {/* Table name */}
      <div className="flex items-center gap-1.5 mb-1">
        <Database className="w-3 h-3 text-content-faint flex-shrink-0" />
        <p className="text-sm font-semibold text-content-primary truncate">{node.name}</p>
      </div>

      {/* Schema / full path */}
      <p className="text-xs text-content-muted truncate mb-1.5">{node.fqn}</p>

      {/* Badges row */}
      <div className="flex flex-wrap gap-1">
        {node.tier && (
          <span className="inline-block text-xs px-1.5 py-0.5 bg-primary-500/10 text-primary-400 border border-primary-500/20 rounded-lg">
            {node.tier.replace('Tier.', '')}
          </span>
        )}
        {primaryRole === 'root' && (
          <span className={`inline-block text-xs px-1.5 py-0.5 rounded-lg ${sevConfig.badge}`}>
            {highestSeverity}
          </span>
        )}
        {isMultiIncident && (
          <span className="inline-block text-xs px-1.5 py-0.5 bg-primary-500/15 text-primary-400 border border-primary-500/25 rounded-lg">
            {node.incidentIds.size} incidents
          </span>
        )}
      </div>

      {/* Owners */}
      {node.owners.length > 0 && (
        <p className="text-xs text-content-faint mt-1.5 truncate">
          {node.owners.join(', ')}
        </p>
      )}

      {/* Tooltip-style incident list on hover */}
      {matchingIncidents.length > 0 && (
        <div className="hidden group-hover:block absolute left-0 top-full mt-2 z-30 w-56 bg-surface-elevated border border-border-subtle rounded-xl shadow-xl p-2 space-y-1">
          <p className="text-xs font-semibold text-content-muted mb-1">Related incidents:</p>
          {matchingIncidents.map((inc) => {
            const sev = SEVERITY_CONFIG[inc.severity] ?? DEFAULT_SEVERITY_CONFIG;
            return (
              <div key={inc.id} className="flex items-center gap-1.5 text-xs">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sev.dot}`} />
                <span className="text-content-primary truncate">{inc.title}</span>
              </div>
            );
          })}
        </div>
      )}
    </a>
  );
}

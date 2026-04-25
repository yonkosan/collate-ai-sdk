import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  GitBranch,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { api } from '../api';
import type { IncidentDetail, IncidentSummary } from '../types';
import { SEVERITY_CONFIG, DEFAULT_SEVERITY_CONFIG } from '../data/constants';
import { LineageGraph } from './LineageGraph';

interface Props {
  incidents: IncidentSummary[];
}

export function UnifiedLineagePage({ incidents }: Props) {
  const [details, setDetails] = useState<IncidentDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [omBaseUrl, setOmBaseUrl] = useState('http://localhost:8585');

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
        <p className="text-sm text-content-muted">Loading lineage data…</p>
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
            Incident Lineage
          </h2>
          <p className="text-xs text-content-muted mt-1">
            Blast radius for {activeIncidents.length} active incident{activeIncidents.length !== 1 ? 's' : ''}
          </p>
        </div>

        <button
          onClick={fetchAllDetails}
          className="p-1.5 rounded-lg border border-border-subtle text-content-muted hover:text-content-primary hover:bg-surface-soft transition-all"
          aria-label="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Per-incident lineage cards — scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pr-1">
        {details.map((detail) => {
          const sev = SEVERITY_CONFIG[detail.severity] ?? DEFAULT_SEVERITY_CONFIG;
          const assetCount = detail.blast_radius
            ? detail.blast_radius.upstream_chain.length +
              1 +
              detail.blast_radius.downstream_impact.length
            : 0;

          return (
            <div
              key={detail.id}
              className={`rounded-xl border ${sev.border} bg-surface-elevated overflow-hidden`}
            >
              {/* Incident header */}
              <div className="flex items-center gap-3 px-5 py-3 border-b border-border-subtle">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${sev.dot}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-content-primary truncate">
                    {detail.title}
                  </p>
                  <p className="text-xs text-content-muted">
                    <span className={`font-bold ${sev.text}`}>{detail.severity}</span>
                    {' · '}{assetCount} asset{assetCount !== 1 ? 's' : ''} in lineage
                    {detail.blast_radius?.root_cause_column && (
                      <span className="text-danger"> · Column: {detail.blast_radius.root_cause_column}</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Lineage graph */}
              <div className="px-4 py-2">
                {detail.blast_radius ? (
                  <LineageGraph blastRadius={detail.blast_radius} omBaseUrl={omBaseUrl} />
                ) : (
                  <p className="text-sm text-content-muted text-center py-6">
                    No lineage data available for this incident.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

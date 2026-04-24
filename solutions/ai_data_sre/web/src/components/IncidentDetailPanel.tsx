import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle,
  ChevronDown,
  ExternalLink,
  FileText,
  GitBranch,
  Shield,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { IncidentDetail, UserInfo } from '../types';
import { FailureHistoryChart } from './FailureHistoryChart';
import { LineageGraph } from './LineageGraph';

const SEVERITY_NAMES: Record<number, string> = {
  1: 'CRITICAL',
  2: 'HIGH',
  3: 'MEDIUM',
  4: 'LOW',
  5: 'INFO',
};

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: 'text-red-400',
  HIGH: 'text-orange-400',
  MEDIUM: 'text-yellow-400',
  LOW: 'text-green-400',
  INFO: 'text-gray-400',
};

interface Props {
  incident: IncidentDetail;
  onBack: () => void;
  onUpdate: (incident: IncidentDetail) => void;
}

export function IncidentDetailPanel({ incident, onBack, onUpdate }: Props) {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [resolveNote, setResolveNote] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const sevName = SEVERITY_NAMES[incident.severity] ?? 'UNKNOWN';
  const sevColor = SEVERITY_COLORS[sevName] ?? 'text-gray-400';

  useEffect(() => {
    api.listUsers().then(setUsers).catch(() => {});
  }, []);

  const handleAcknowledge = useCallback(async () => {
    setActionLoading('ack');
    try {
      await api.acknowledgeIncident(incident.id);
      const updated = await api.getIncident(incident.id);
      onUpdate(updated);
    } finally {
      setActionLoading(null);
    }
  }, [incident.id, onUpdate]);

  const handleAssign = useCallback(
    async (assignee: string) => {
      setActionLoading('assign');
      setShowAssignDropdown(false);
      try {
        await api.assignIncident(incident.id, assignee);
        const updated = await api.getIncident(incident.id);
        onUpdate(updated);
      } finally {
        setActionLoading(null);
      }
    },
    [incident.id, onUpdate]
  );

  const handleResolve = useCallback(async () => {
    if (!resolveNote.trim()) return;
    setActionLoading('resolve');
    setShowResolveModal(false);
    try {
      await api.resolveIncident(incident.id, resolveNote);
      const updated = await api.getIncident(incident.id);
      onUpdate(updated);
    } finally {
      setActionLoading(null);
      setResolveNote('');
    }
  }, [incident.id, resolveNote, onUpdate]);

  const omBaseUrl = 'http://localhost:8585';

  return (
    <div>
      {/* Back button and header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <span className={`text-sm font-bold ${sevColor}`}>{sevName}</span>
            <span className="text-xs text-gray-500 uppercase tracking-wider">
              {incident.status}
            </span>
            <span className="text-xs text-gray-600 font-mono">{incident.id}</span>
          </div>
          <h2 className="text-xl font-bold text-white">{incident.title}</h2>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 mb-8">
        {incident.status !== 'acknowledged' && incident.status !== 'resolved' && (
          <button
            onClick={handleAcknowledge}
            disabled={actionLoading === 'ack'}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            Acknowledge
          </button>
        )}

        <div className="relative">
          <button
            onClick={() => setShowAssignDropdown(!showAssignDropdown)}
            disabled={actionLoading === 'assign'}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors disabled:opacity-50"
          >
            <UserPlus className="w-4 h-4" />
            {incident.assigned_to ? `Assigned: ${incident.assigned_to}` : 'Assign'}
            <ChevronDown className="w-3 h-3" />
          </button>
          {showAssignDropdown && (
            <div className="absolute top-full mt-1 left-0 w-56 bg-pulse-card border border-pulse-border rounded-lg shadow-xl z-10 py-1">
              {users.map((u) => (
                <button
                  key={u.name}
                  onClick={() => handleAssign(u.name)}
                  className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-pulse-border/50 flex items-center gap-2"
                >
                  <User className="w-3.5 h-3.5 text-gray-500" />
                  {u.display_name}
                </button>
              ))}
            </div>
          )}
        </div>

        {incident.status !== 'resolved' && (
          <button
            onClick={() => setShowResolveModal(true)}
            disabled={actionLoading === 'resolve'}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-green-500/30 text-green-400 hover:bg-green-500/10 rounded-lg transition-colors disabled:opacity-50"
          >
            <CheckCircle className="w-4 h-4" />
            Resolve
          </button>
        )}

        {incident.blast_radius && (
          <a
            href={`${omBaseUrl}/table/${incident.blast_radius.root_cause_table}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 text-sm border border-pulse-border text-gray-400 hover:text-white hover:bg-pulse-border/50 rounded-lg transition-colors ml-auto"
          >
            <ExternalLink className="w-4 h-4" />
            View in OpenMetadata
          </a>
        )}
      </div>

      {/* Resolve modal */}
      {showResolveModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-pulse-card border border-pulse-border rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Resolve Incident</h3>
              <button onClick={() => setShowResolveModal(false)}>
                <X className="w-5 h-5 text-gray-400 hover:text-white" />
              </button>
            </div>
            <textarea
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              placeholder="Describe how this incident was resolved..."
              className="w-full h-32 bg-pulse-bg border border-pulse-border rounded-lg p-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50 resize-none"
            />
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => setShowResolveModal(false)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleResolve}
                disabled={!resolveNote.trim()}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                Resolve
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content grid */}
      <div className="grid grid-cols-3 gap-6">
        {/* Left column: Report */}
        <div className="col-span-2 space-y-6">
          {/* AI Report */}
          {incident.report && (
            <section className="bg-pulse-card border border-pulse-border rounded-lg p-6">
              <h3 className="flex items-center gap-2 text-base font-semibold text-white mb-4">
                <FileText className="w-4 h-4 text-blue-400" />
                AI Incident Report
              </h3>
              <div className="space-y-4 text-sm text-gray-300">
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Summary
                  </h4>
                  <p>{incident.report.summary}</p>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Root Cause Analysis
                  </h4>
                  <p>{incident.report.root_cause_analysis}</p>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Blast Radius
                  </h4>
                  <p>{incident.report.blast_radius_description}</p>
                </div>
                {incident.report.stakeholders_affected && (
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Stakeholders Affected
                    </h4>
                    <p>{incident.report.stakeholders_affected}</p>
                  </div>
                )}
                {incident.report.trend_analysis && (
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Trend Analysis
                    </h4>
                    <p>{incident.report.trend_analysis}</p>
                  </div>
                )}
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Recommendations
                  </h4>
                  <ol className="list-decimal list-inside space-y-1">
                    {incident.report.recommendations.map((rec, i) => (
                      <li key={i}>{rec}</li>
                    ))}
                  </ol>
                </div>
              </div>
            </section>
          )}

          {/* Lineage Graph */}
          {incident.blast_radius && (
            <section className="bg-pulse-card border border-pulse-border rounded-lg p-6">
              <h3 className="flex items-center gap-2 text-base font-semibold text-white mb-4">
                <GitBranch className="w-4 h-4 text-purple-400" />
                Blast Radius &amp; Lineage
              </h3>
              <LineageGraph blastRadius={incident.blast_radius} omBaseUrl={omBaseUrl} />
            </section>
          )}

          {/* Failure History */}
          {incident.failure_histories.length > 0 && (
            <section className="bg-pulse-card border border-pulse-border rounded-lg p-6">
              <h3 className="flex items-center gap-2 text-base font-semibold text-white mb-4">
                <Shield className="w-4 h-4 text-yellow-400" />
                Failure History
              </h3>
              <div className="space-y-4">
                {incident.failure_histories.map((history) => (
                  <FailureHistoryChart key={history.test_case_name} history={history} />
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right column: Metadata sidebar */}
        <div className="space-y-6">
          {/* Failed Tests */}
          <section className="bg-pulse-card border border-pulse-border rounded-lg p-5">
            <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Failed Tests
            </h4>
            <div className="space-y-3">
              {incident.failures.map((f) => (
                <div
                  key={f.test_case_id}
                  className="bg-pulse-bg rounded-lg p-3 border border-pulse-border"
                >
                  <p className="text-sm font-medium text-white mb-1">
                    {f.test_case_name}
                  </p>
                  <p className="text-xs text-gray-400 mb-1">
                    {f.table_fqn.split('.').pop()}
                    {f.column ? ` → ${f.column}` : ''}
                  </p>
                  <p className="text-xs text-red-300">{f.result_message}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Affected Assets */}
          {incident.blast_radius && (
            <section className="bg-pulse-card border border-pulse-border rounded-lg p-5">
              <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Affected Assets ({incident.blast_radius.total_affected_assets})
              </h4>
              <div className="space-y-2">
                {[
                  ...incident.blast_radius.upstream_chain,
                  ...incident.blast_radius.downstream_impact,
                ].map((asset) => {
                  const shortName = asset.fqn.split('.').pop() ?? asset.fqn;
                  return (
                    <a
                      key={asset.fqn}
                      href={`${omBaseUrl}/table/${asset.fqn}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block bg-pulse-bg rounded-lg p-3 border border-pulse-border hover:border-blue-500/30 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-white font-medium">
                          {shortName}
                        </span>
                        <ExternalLink className="w-3 h-3 text-gray-500" />
                      </div>
                      {asset.tier && (
                        <span className="inline-block text-xs px-1.5 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded mr-2">
                          {asset.tier.replace('Tier.', '')}
                        </span>
                      )}
                      {asset.owners.length > 0 && (
                        <span className="text-xs text-gray-400">
                          Owner: {asset.owners.join(', ')}
                        </span>
                      )}
                      {asset.description && (
                        <p className="text-xs text-gray-500 mt-1 truncate">
                          {asset.description}
                        </p>
                      )}
                    </a>
                  );
                })}
              </div>
            </section>
          )}

          {/* Resolution info */}
          {incident.resolved_at && (
            <section className="bg-pulse-card border border-green-500/20 rounded-lg p-5">
              <h4 className="text-sm font-semibold text-green-400 mb-2">
                ✓ Resolved
              </h4>
              <p className="text-sm text-gray-300">
                {incident.resolution_note}
              </p>
              <p className="text-xs text-gray-500 mt-2">
                {new Date(incident.resolved_at).toLocaleString()}
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

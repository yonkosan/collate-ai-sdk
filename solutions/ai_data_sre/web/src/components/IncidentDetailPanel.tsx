import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle,
  ChevronDown,
  Clock,
  ExternalLink,
  FileText,
  GitBranch,
  Loader2,
  Search,
  Shield,
  ShieldCheck,
  ShieldX,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { ResolveResponse } from '../api';
import type { IncidentDetail, UserInfo } from '../types';
import { SEVERITY_CONFIG, DEFAULT_SEVERITY_CONFIG, STATUS_CONFIG } from '../data/constants';
import { OpenMetadataIcon, SlackIcon } from './BrandIcons';
import { FailureHistoryChart } from './FailureHistoryChart';
import { LineageGraph } from './LineageGraph';

const RESOLUTION_CATEGORIES = [
  { value: '', label: 'Select category\u2026' },
  { value: 'schema_change', label: 'Schema Change' },
  { value: 'data_issue', label: 'Data Issue / Bad Source Data' },
  { value: 'pipeline_bug', label: 'Pipeline / ETL Bug' },
  { value: 'config_error', label: 'Configuration Error' },
  { value: 'external_dependency', label: 'External Dependency' },
  { value: 'false_positive', label: 'False Positive / Test Tuning' },
];

interface Props {
  incident: IncidentDetail;
  onBack: () => void;
  onUpdate: (incident: IncidentDetail) => void;
}

export function IncidentDetailPanel({ incident, onBack, onUpdate }: Props) {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [resolveNote, setResolveNote] = useState('');
  const [resolveCategory, setResolveCategory] = useState('');
  const [skipVerification, setSkipVerification] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [omBaseUrl, setOmBaseUrl] = useState('http://localhost:8585');
  const [resolveResult, setResolveResult] = useState<ResolveResponse | null>(null);
  const [preVerifyResult, setPreVerifyResult] = useState<{ passed: boolean; message: string } | null>(null);
  const [preVerifyLoading, setPreVerifyLoading] = useState(false);

  const sev = SEVERITY_CONFIG[incident.severity] ?? DEFAULT_SEVERITY_CONFIG;
  const status = STATUS_CONFIG[incident.status] ?? { color: 'text-content-muted', label: incident.status };

  useEffect(() => {
    api.listUsers().then(setUsers).catch(() => {});
    api.getConfig().then((cfg) => setOmBaseUrl(cfg.om_base_url)).catch(() => {});
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

  const handlePreVerify = useCallback(async () => {
    setPreVerifyLoading(true);
    setPreVerifyResult(null);
    try {
      const result = await api.verifyIncident(incident.id);
      setPreVerifyResult(result);
    } catch {
      setPreVerifyResult({ passed: false, message: 'Verification check failed' });
    } finally {
      setPreVerifyLoading(false);
    }
  }, [incident.id]);

  const handleResolve = useCallback(async () => {
    if (!resolveNote.trim()) return;
    setActionLoading('resolve');
    setResolveResult(null);
    try {
      const result = await api.resolveIncident(
        incident.id, resolveNote, 'admin', resolveCategory, skipVerification,
      );
      if (result.status === 'rejected') {
        setResolveResult(result);
        setActionLoading(null);
        return;
      }
      setShowResolveModal(false);
      const updated = await api.getIncident(incident.id);
      onUpdate(updated);
    } catch (err) {
      setResolveResult({
        status: 'rejected',
        incident_id: incident.id,
        message: err instanceof Error ? err.message : 'Resolution failed',
      });
    } finally {
      setActionLoading(null);
    }
  }, [incident.id, resolveNote, resolveCategory, skipVerification, onUpdate]);

  const omTableUrl = incident.blast_radius
    ? `${omBaseUrl}/table/${incident.blast_radius.root_cause_table}`
    : null;
  const omDqUrl = incident.blast_radius
    ? `${omBaseUrl}/table/${incident.blast_radius.root_cause_table}?activeTab=profiler`
    : null;

  return (
    <div className="animate-fade-in">
      {/* Back + header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={onBack} className="flex items-center gap-1.5 text-content-muted hover:text-content-primary transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <span className={`w-2.5 h-2.5 rounded-full ${sev.dot}`} />
            <span className={`text-sm font-bold ${sev.text}`}>{incident.severity}</span>
            <span className={`text-xs font-medium ${status.color} uppercase tracking-wider`}>{status.label}</span>
            <span className="text-xs text-content-faint font-mono">{incident.id}</span>
          </div>
          <h2 className="text-xl font-bold text-content-primary tracking-tight">{incident.title}</h2>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap gap-3 mb-8">
        {incident.status !== 'acknowledged' && incident.status !== 'resolved' && (
          <ActionButton onClick={handleAcknowledge} disabled={actionLoading === 'ack'} icon={<Check className="w-4 h-4" />} label="Acknowledge" variant="purple" />
        )}
        <div className="relative">
          <ActionButton onClick={() => setShowAssignDropdown(!showAssignDropdown)} disabled={actionLoading === 'assign'} icon={<UserPlus className="w-4 h-4" />} label={incident.assigned_to ? `Assigned: ${incident.assigned_to}` : 'Assign'} variant="blue" trailingIcon={<ChevronDown className="w-3 h-3" />} />
          {showAssignDropdown && (
            <div className="absolute top-full mt-1 left-0 w-64 bg-surface-elevated border border-border-subtle rounded-xl shadow-card z-10 py-1 animate-slide-up">
              <div className="px-3 py-2 border-b border-divider">
                <div className="flex items-center gap-2 bg-surface-inset border border-border-subtle rounded-lg px-2.5 py-1.5">
                  <Search className="w-3.5 h-3.5 text-content-faint" />
                  <input type="text" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="Search users\u2026" className="bg-transparent text-xs text-content-primary placeholder-content-faint focus:outline-none w-full" autoFocus />
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {users.filter((u) => !userSearch || u.display_name.toLowerCase().includes(userSearch.toLowerCase()) || u.name.toLowerCase().includes(userSearch.toLowerCase())).map((u) => (
                  <button key={u.name} onClick={() => { handleAssign(u.name); setUserSearch(''); }} className="w-full text-left px-4 py-2 text-sm text-content-secondary hover:text-content-primary hover:bg-surface-soft flex items-center gap-2 transition-colors">
                    <User className="w-3.5 h-3.5 text-content-faint" />
                    {u.display_name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {incident.status !== 'resolved' && (
          <ActionButton onClick={() => { setShowResolveModal(true); setResolveResult(null); setPreVerifyResult(null); }} disabled={actionLoading === 'resolve'} icon={<CheckCircle className="w-4 h-4" />} label="Resolve" variant="green" />
        )}
        <div className="flex-1" />
        {omDqUrl && (
          <a href={omDqUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 text-sm border border-warning/30 text-warning hover:bg-warning/10 rounded-xl transition-all">
            <Shield className="w-4 h-4" />
            View DQ Tests
          </a>
        )}
        {omTableUrl && (
          <a href={omTableUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 text-sm border border-border-subtle text-content-muted hover:text-content-primary hover:bg-surface-soft rounded-xl transition-all">
            <OpenMetadataIcon className="w-4 h-4" />
            OpenMetadata
          </a>
        )}
        {incident.slack_thread_url && (
          <a href={incident.slack_thread_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 text-sm border border-primary-500/30 text-primary-400 hover:bg-primary-500/10 rounded-xl transition-all">
            <SlackIcon className="w-4 h-4" />
            Slack Thread
          </a>
        )}
      </div>

      {/* ═══ Enhanced Resolve Modal ═══ */}
      {showResolveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface-elevated border border-border-subtle rounded-2xl w-full max-w-lg shadow-card animate-slide-up max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <h3 className="text-lg font-semibold text-content-primary">Resolve Incident</h3>
              <button onClick={() => setShowResolveModal(false)} className="text-content-muted hover:text-content-primary transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 pb-5 space-y-4">
              {/* Failure context */}
              <div className="bg-danger/5 border border-danger/20 rounded-xl p-3.5">
                <h4 className="text-xs font-semibold text-danger uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Original Failures
                </h4>
                <div className="space-y-1.5">
                  {incident.failures.map((f) => (
                    <div key={f.test_case_id} className="text-xs">
                      <span className="font-medium text-content-primary">{f.test_case_name}</span>
                      <span className="text-content-faint"> on </span>
                      <span className="text-content-muted">{f.table_fqn.split('.').pop()}</span>
                      {f.column && <span className="text-content-faint"> &rarr; {f.column}</span>}
                      <p className="text-danger/80 mt-0.5 truncate">{f.result_message}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Pre-verification */}
              <div className="flex items-center gap-3">
                <button onClick={handlePreVerify} disabled={preVerifyLoading} className="flex items-center gap-2 px-3 py-1.5 text-xs border border-secondary-500/30 text-secondary-400 hover:bg-secondary-500/10 rounded-lg transition-all disabled:opacity-50">
                  {preVerifyLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                  Check if tests are passing
                </button>
                {preVerifyResult && (
                  <span className={`text-xs font-medium ${preVerifyResult.passed ? 'text-success' : 'text-danger'}`}>
                    {preVerifyResult.passed ? '\u2713 All tests passing' : '\u2717 Still failing'}
                  </span>
                )}
              </div>

              {/* Category */}
              <div>
                <label className="text-xs font-medium text-content-muted block mb-1.5">Root Cause Category</label>
                <select value={resolveCategory} onChange={(e) => setResolveCategory(e.target.value)} className="w-full bg-surface-inset border border-border-subtle rounded-xl px-3 py-2 text-sm text-content-primary focus:outline-none focus:border-success/50 transition-colors">
                  {RESOLUTION_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>

              {/* Note */}
              <div>
                <label className="text-xs font-medium text-content-muted block mb-1.5">Resolution Note</label>
                <textarea value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} placeholder="Describe what was fixed and how (validated against actual failure)\u2026" className="w-full h-28 bg-surface-inset border border-border-subtle rounded-xl p-3 text-sm text-content-primary placeholder-content-faint focus:outline-none focus:border-success/50 resize-none transition-colors" />
              </div>

              {/* Skip toggle */}
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={skipVerification} onChange={(e) => setSkipVerification(e.target.checked)} className="w-4 h-4 rounded border-border-subtle accent-warning" />
                <span className="text-xs text-content-muted">Skip DQ verification (force resolve)</span>
              </label>

              {/* Rejection */}
              {resolveResult && resolveResult.status === 'rejected' && (
                <div className="bg-danger/5 border border-danger/20 rounded-xl p-4 animate-slide-up">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldX className="w-4 h-4 text-danger" />
                    <h4 className="text-sm font-semibold text-danger">Resolution Rejected</h4>
                  </div>
                  <p className="text-xs text-content-secondary mb-2">{resolveResult.message}</p>
                  {resolveResult.still_failing_tests && resolveResult.still_failing_tests.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs font-medium text-content-muted mb-1">Still failing:</p>
                      {resolveResult.still_failing_tests.map((t) => <p key={t} className="text-xs text-danger">&bull; {t}</p>)}
                    </div>
                  )}
                  <p className="text-xs text-content-faint mt-2">Fix the issue first, or toggle &ldquo;Skip DQ verification&rdquo; to force resolve.</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-border-subtle">
              <button onClick={() => setShowResolveModal(false)} className="px-4 py-2 text-sm text-content-muted hover:text-content-primary transition-colors">Cancel</button>
              <button onClick={handleResolve} disabled={!resolveNote.trim() || actionLoading === 'resolve'} className="px-5 py-2 text-sm font-semibold bg-success text-black rounded-xl hover:bg-success-soft disabled:opacity-50 transition-colors flex items-center gap-2">
                {actionLoading === 'resolve' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {skipVerification ? 'Force Resolve' : 'Verify & Resolve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* AI Report */}
          {incident.report && (
            <GlassCard>
              <h3 className="flex items-center gap-2 text-base font-semibold text-content-primary mb-5">
                <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary-500/15"><FileText className="w-4 h-4 text-primary-400" /></span>
                AI Incident Report
              </h3>
              <div className="space-y-5 text-sm text-content-secondary leading-relaxed">
                <ReportSection title="Summary" content={incident.report.summary} />
                <ReportSection title="Root Cause Analysis" content={incident.report.root_cause_analysis} />
                <ReportSection title="Blast Radius" content={incident.report.blast_radius_description} />
                {incident.report.stakeholders_affected && <ReportSection title="Stakeholders Affected" content={incident.report.stakeholders_affected} />}
                {incident.report.trend_analysis && <ReportSection title="Trend Analysis" content={incident.report.trend_analysis} />}
                <div>
                  <SectionLabel>Recommendations</SectionLabel>
                  <ol className="list-decimal list-inside space-y-1.5">
                    {incident.report.recommendations.map((rec, i) => <li key={i}>{rec}</li>)}
                  </ol>
                </div>
              </div>
            </GlassCard>
          )}

          {/* Lineage */}
          {incident.blast_radius && (
            <GlassCard>
              <h3 className="flex items-center gap-2 text-base font-semibold text-content-primary mb-5">
                <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary-500/15"><GitBranch className="w-4 h-4 text-primary-400" /></span>
                Blast Radius &amp; Lineage
              </h3>
              <LineageGraph blastRadius={incident.blast_radius} omBaseUrl={omBaseUrl} />
            </GlassCard>
          )}

          {/* Failure History */}
          {incident.failure_histories.length > 0 && (
            <GlassCard>
              <h3 className="flex items-center gap-2 text-base font-semibold text-content-primary mb-5">
                <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-warning/15"><Shield className="w-4 h-4 text-warning" /></span>
                Failure History
              </h3>
              <div className="space-y-4">
                {incident.failure_histories.map((h) => <FailureHistoryChart key={h.test_case_name} history={h} />)}
              </div>
            </GlassCard>
          )}

          {/* ═══ Incident Timeline ═══ */}
          {incident.events && incident.events.length > 0 && (
            <GlassCard>
              <h3 className="flex items-center gap-2 text-base font-semibold text-content-primary mb-5">
                <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-secondary-500/15"><Clock className="w-4 h-4 text-secondary-400" /></span>
                Incident Timeline
              </h3>
              <div className="relative pl-6">
                <div className="absolute left-[9px] top-1 bottom-1 w-px bg-border-subtle" />
                <div className="space-y-3">
                  <TimelineEntry action="created" actor="system" detail={incident.title} timestamp={incident.created_at} />
                  {incident.events.map((evt, i) => <TimelineEntry key={i} action={evt.action} actor={evt.actor} detail={evt.detail} timestamp={evt.timestamp} />)}
                </div>
              </div>
            </GlassCard>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* Failed Tests */}
          <GlassCard>
            <SectionLabel>Failed Tests</SectionLabel>
            <div className="space-y-3 mt-3">
              {incident.failures.map((f) => (
                <div key={f.test_case_id} className="bg-surface-inset rounded-xl p-3.5 border border-border-subtle">
                  <p className="text-sm font-medium text-content-primary mb-1">{f.test_case_name}</p>
                  <p className="text-xs text-content-muted mb-1">{f.table_fqn.split('.').pop()}{f.column ? ` \u2192 ${f.column}` : ''}</p>
                  <p className="text-xs text-danger">{f.result_message}</p>
                  {f.faulty_rows && f.faulty_rows.length > 0 && (
                    <details className="mt-2.5">
                      <summary className="text-xs text-warning cursor-pointer hover:text-primary-400 transition-colors">{f.faulty_rows.length} faulty row(s)</summary>
                      <div className="mt-1.5 overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead><tr className="text-content-faint border-b border-border-subtle">{Object.keys(f.faulty_rows[0]?.row_data ?? {}).map((col) => <th key={col} className="text-left py-1 pr-2 font-medium">{col}</th>)}<th className="text-left py-1 font-medium">reason</th></tr></thead>
                          <tbody>{f.faulty_rows.map((row, idx) => <tr key={idx} className="text-content-secondary border-b border-border-subtle/50">{Object.values(row.row_data).map((val, ci) => <td key={ci} className="py-1 pr-2 truncate max-w-24">{val}</td>)}<td className="py-1 text-danger truncate max-w-28">{row.reason}</td></tr>)}</tbody>
                        </table>
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </GlassCard>

          {/* Affected Assets */}
          {incident.blast_radius && (
            <GlassCard>
              <SectionLabel>Affected Assets ({incident.blast_radius.total_affected_assets})</SectionLabel>
              <div className="space-y-2 mt-3">
                {[...incident.blast_radius.upstream_chain, ...incident.blast_radius.downstream_impact].map((asset) => {
                  const shortName = asset.fqn.split('.').pop() ?? asset.fqn;
                  return (
                    <a key={asset.fqn} href={`${omBaseUrl}/table/${asset.fqn}`} target="_blank" rel="noopener noreferrer" className="block bg-surface-inset rounded-xl p-3 border border-border-subtle hover:border-primary-500/30 transition-all">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-content-primary font-medium">{shortName}</span>
                        <ExternalLink className="w-3 h-3 text-content-faint" />
                      </div>
                      {asset.tier && <span className="inline-block text-xs px-1.5 py-0.5 bg-primary-500/10 text-primary-400 border border-primary-500/20 rounded-lg mr-2">{asset.tier.replace('Tier.', '')}</span>}
                      {asset.owners.length > 0 && <span className="text-xs text-content-muted">Owner: {asset.owners.join(', ')}</span>}
                      {asset.description && <p className="text-xs text-content-faint mt-1 truncate">{asset.description}</p>}
                    </a>
                  );
                })}
              </div>
            </GlassCard>
          )}

          {/* Verification Result */}
          {incident.verification_result && (
            <div className={`rounded-xl border p-5 ${incident.verification_result.passed ? 'border-success/20 bg-success/5' : 'border-danger/20 bg-danger/5'}`}>
              <h4 className={`text-sm font-semibold mb-2 flex items-center gap-2 ${incident.verification_result.passed ? 'text-success' : 'text-danger'}`}>
                {incident.verification_result.passed ? <ShieldCheck className="w-4 h-4" /> : <ShieldX className="w-4 h-4" />}
                DQ Verification
              </h4>
              <p className="text-sm text-content-secondary">{incident.verification_result.message}</p>
              {incident.verification_result.note_alignment && (
                <div className="mt-2 pt-2 border-t border-border-subtle">
                  <p className="text-xs text-content-muted">
                    Note alignment:{' '}
                    <span className={`font-semibold ${incident.verification_result.note_alignment.confidence === 'HIGH' ? 'text-success' : incident.verification_result.note_alignment.confidence === 'MEDIUM' ? 'text-warning' : 'text-danger'}`}>
                      {incident.verification_result.note_alignment.confidence}
                    </span>
                  </p>
                  <p className="text-xs text-content-faint mt-0.5">{incident.verification_result.note_alignment.explanation}</p>
                </div>
              )}
              <p className="text-xs text-content-faint mt-2">{new Date(incident.verification_result.verified_at).toLocaleString()}</p>
            </div>
          )}

          {/* Acknowledged */}
          {incident.acknowledged_by && incident.acknowledged_at && (
            <div className="rounded-xl border border-primary-500/20 bg-primary-500/5 p-5">
              <h4 className="text-sm font-semibold text-primary-400 mb-2">&check; Acknowledged</h4>
              <p className="text-sm text-content-secondary">by <span className="text-content-primary font-medium">{incident.acknowledged_by}</span></p>
              <p className="text-xs text-content-muted mt-1">{new Date(incident.acknowledged_at).toLocaleString()}</p>
            </div>
          )}

          {/* Resolved */}
          {incident.resolved_at && (
            <div className="rounded-xl border border-success/20 bg-success/5 p-5">
              <h4 className="text-sm font-semibold text-success mb-2">&check; Resolved</h4>
              <p className="text-sm text-content-secondary">{incident.resolution_note}</p>
              {incident.resolution_category && (
                <p className="text-xs text-content-muted mt-1.5">Category: <span className="font-medium text-content-primary">{incident.resolution_category}</span></p>
              )}
              {incident.resolved_by && <p className="text-xs text-content-muted mt-1">by <span className="text-content-primary font-medium">{incident.resolved_by}</span></p>}
              <p className="text-xs text-content-faint mt-1">{new Date(incident.resolved_at).toLocaleString()}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Subcomponents ────────────────────────────────────────── */

function GlassCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="relative overflow-hidden rounded-xl border border-border-subtle bg-surface-elevated p-6">
      <div className="absolute inset-0 bg-noise opacity-20 pointer-events-none" />
      <div className="relative z-10">{children}</div>
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h4 className="text-xs font-semibold text-content-muted uppercase tracking-wider">{children}</h4>;
}

function ReportSection({ title, content }: { title: string; content: string }) {
  return <div><SectionLabel>{title}</SectionLabel><p className="mt-1">{content}</p></div>;
}

const EVENT_CONFIG: Record<string, { icon: string; color: string }> = {
  created: { icon: '\ud83d\udfe2', color: 'text-secondary-400' },
  detected: { icon: '\ud83d\udd0d', color: 'text-content-muted' },
  investigating: { icon: '\ud83d\udd0e', color: 'text-secondary-400' },
  reported: { icon: '\ud83d\udcdd', color: 'text-primary-400' },
  acknowledged: { icon: '\u2705', color: 'text-primary-400' },
  assigned: { icon: '\ud83d\udc64', color: 'text-secondary-400' },
  resolve_attempted: { icon: '\ud83d\udd04', color: 'text-warning' },
  resolve_rejected: { icon: '\u274c', color: 'text-danger' },
  resolved: { icon: '\ud83c\udf89', color: 'text-success' },
};

function TimelineEntry({ action, actor, detail, timestamp }: { action: string; actor: string; detail: string; timestamp: string }) {
  const cfg = EVENT_CONFIG[action] ?? { icon: '\u2022', color: 'text-content-muted' };
  const time = new Date(timestamp);
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = time.toLocaleDateString([], { month: 'short', day: 'numeric' });

  return (
    <div className="relative flex items-start gap-3 group">
      <div className="absolute -left-6 top-1 w-[7px] h-[7px] rounded-full bg-border-subtle border-2 border-surface-elevated group-hover:bg-primary-400 transition-colors" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs">{cfg.icon}</span>
          <span className={`text-xs font-semibold capitalize ${cfg.color}`}>{action.replace(/_/g, ' ')}</span>
          {actor !== 'system' && <span className="text-xs text-content-faint">by {actor}</span>}
          <span className="text-xs text-content-faint ml-auto tabular-nums">{dateStr} {timeStr}</span>
        </div>
        {detail && <p className="text-xs text-content-muted mt-0.5 truncate">{detail}</p>}
      </div>
    </div>
  );
}

function ActionButton({ onClick, disabled, icon, label, variant, trailingIcon }: { onClick: () => void; disabled: boolean; icon: React.ReactNode; label: string; variant: 'purple' | 'blue' | 'green'; trailingIcon?: React.ReactNode }) {
  const colors = { purple: 'border-primary-500/30 text-primary-400 hover:bg-primary-500/10', blue: 'border-secondary-500/30 text-secondary-400 hover:bg-secondary-500/10', green: 'border-success/30 text-success hover:bg-success/10' };
  return (
    <button onClick={onClick} disabled={disabled} className={`flex items-center gap-2 px-4 py-2 text-sm border rounded-xl transition-all disabled:opacity-50 ${colors[variant]}`}>
      {icon}{label}{trailingIcon}
    </button>
  );
}

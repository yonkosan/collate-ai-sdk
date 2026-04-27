import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle,
  ChevronDown,
  Clock,
  Code,
  ExternalLink,
  FileText,
  GitBranch,
  Lightbulb,
  Loader2,
  Play,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  ShieldPlus,
  ShieldX,
  Sparkles,
  TrendingUp,
  User,
  UserPlus,
  Users,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { api } from '../api';
import type { ResolveResponse } from '../api';
import type { FixSuggestion, GuardrailResult, IncidentDetail, RerunResult, UserInfo } from '../types';
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

// ─── Fix Wizard Step ────────────────────────────────────────────────────
type FixStep = 'idle' | 'suggesting' | 'review' | 'executing' | 'executed' | 'rerunning' | 'rerun_done';

interface Props {
  incident: IncidentDetail;
  onBack: () => void;
  onUpdate: (incident: IncidentDetail) => void;
}

export function IncidentDetailPanel({ incident, onBack, onUpdate }: Props) {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [omBaseUrl, setOmBaseUrl] = useState('http://localhost:8585');

  // ── Resolve modal state ──
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [resolveNote, setResolveNote] = useState('');
  const [resolveCategory, setResolveCategory] = useState('');
  const [skipVerification, setSkipVerification] = useState(false);
  const [resolveResult, setResolveResult] = useState<ResolveResponse | null>(null);

  // ── Fix wizard state ──
  const [fixStep, setFixStep] = useState<FixStep>('idle');
  const [fixSuggestions, setFixSuggestions] = useState<FixSuggestion[]>([]);

  const [fixResult, setFixResult] = useState<{ success: boolean; message: string; rows_affected: number } | null>(null);
  const [rerunResults, setRerunResults] = useState<RerunResult[]>([]);
  const [preVerifyResult, setPreVerifyResult] = useState<{ passed: boolean; message: string } | null>(null);
  const [preVerifyLoading, setPreVerifyLoading] = useState(false);

  // ── Guardrail state ──
  const [guardrailResults, setGuardrailResults] = useState<Record<number, GuardrailResult>>({});
  const [guardrailLoading, setGuardrailLoading] = useState<number | null>(null);

  const sev = SEVERITY_CONFIG[incident.severity] ?? DEFAULT_SEVERITY_CONFIG;
  const status = STATUS_CONFIG[incident.status] ?? { color: 'text-content-muted', label: incident.status };

  useEffect(() => {
    api.listUsers().then(setUsers).catch(() => {});
    api.getConfig().then((cfg) => setOmBaseUrl(cfg.om_base_url)).catch(() => {});
  }, []);

  // Poll for AI report if still generating
  useEffect(() => {
    if (!incident.report_generating || incident.report) return;
    const interval = setInterval(async () => {
      try {
        const updated = await api.getIncident(incident.id);
        if (updated.report || !updated.report_generating) {
          onUpdate(updated);
        }
      } catch { /* ignore */ }
    }, 4000);
    return () => clearInterval(interval);
  }, [incident.id, incident.report_generating, incident.report, onUpdate]);

  // ── Actions ──
  const handleAcknowledge = useCallback(async () => {
    setActionLoading('ack');
    try {
      await api.acknowledgeIncident(incident.id);
      const updated = await api.getIncident(incident.id);
      onUpdate(updated);
    } finally { setActionLoading(null); }
  }, [incident.id, onUpdate]);

  const handleAssign = useCallback(async (assignee: string) => {
    setActionLoading('assign');
    setShowAssignDropdown(false);
    try {
      await api.assignIncident(incident.id, assignee);
      const updated = await api.getIncident(incident.id);
      onUpdate(updated);
    } finally { setActionLoading(null); }
  }, [incident.id, onUpdate]);

  // ── Fix Wizard ──
  const handleSuggestFix = useCallback(async () => {
    setFixStep('suggesting');
    setFixSuggestions([]);
    setFixResult(null);
    setRerunResults([]);
    setPreVerifyResult(null);
    setGuardrailResults({});
    setGuardrailLoading(null);
    try {
      const res = await api.suggestFix(incident.id);
      setFixSuggestions(res.suggestions);

      setFixStep('review');
    } catch {
      setFixStep('idle');
    }
  }, [incident.id]);

  const handleExecuteFix = useCallback(async (sql: string) => {
    if (!sql.trim()) return;
    setFixStep('executing');
    setFixResult(null);
    try {
      const res = await api.executeFix(incident.id, sql);
      setFixResult(res);
      setFixStep('executed');
    } catch (err) {
      setFixResult({ success: false, message: err instanceof Error ? err.message : 'Execution failed', rows_affected: 0 });
      setFixStep('executed');
    }
  }, [incident.id]);

  const handleRerunTests = useCallback(async () => {
    setFixStep('rerunning');
    setRerunResults([]);
    const results: RerunResult[] = [];
    for (const f of incident.failures) {
      try {
        const r = await api.rerunTest(incident.id, f.test_case_id, f.test_case_name);
        results.push(r);
      } catch {
        results.push({ test_case_name: f.test_case_name, status: 'Error', message: 'Request failed', timestamp: '' });
      }
    }
    setRerunResults(results);
    setFixStep('rerun_done');
  }, [incident.id, incident.failures]);

  const handlePreVerify = useCallback(async () => {
    setPreVerifyLoading(true);
    setPreVerifyResult(null);
    try {
      const result = await api.verifyIncident(incident.id);
      setPreVerifyResult(result);
    } catch {
      setPreVerifyResult({ passed: false, message: 'Verification check failed' });
    } finally { setPreVerifyLoading(false); }
  }, [incident.id]);

  const handleAddGuardrail = useCallback(async (suggestion: FixSuggestion, idx: number) => {
    setGuardrailLoading(idx);
    try {
      const safeName = suggestion.test_definition.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
        + '_' + suggestion.entity_link.split('::').pop()?.replace(/[^a-zA-Z0-9]/g, '_') || 'guardrail';
      const result = await api.addGuardrail(
        incident.id,
        safeName,
        suggestion.test_definition,
        suggestion.entity_link,
        suggestion.parameter_values,
        suggestion.description,
      );
      setGuardrailResults((prev) => ({ ...prev, [idx]: result }));
    } catch (err) {
      setGuardrailResults((prev) => ({
        ...prev,
        [idx]: { success: false, message: err instanceof Error ? err.message : 'Failed', test_case_name: '', test_case_id: '', om_link: '', created_at: '' },
      }));
    } finally { setGuardrailLoading(null); }
  }, [incident.id]);

  const handleResolve = useCallback(async () => {
    if (!resolveNote.trim()) return;
    setActionLoading('resolve');
    setResolveResult(null);
    try {
      const result = await api.resolveIncident(incident.id, resolveNote, 'admin', resolveCategory, skipVerification);
      if (result.status === 'rejected') {
        setResolveResult(result);
        return;
      }
      setShowResolveModal(false);
      const updated = await api.getIncident(incident.id);
      onUpdate(updated);
    } catch (err) {
      setResolveResult({ status: 'rejected', incident_id: incident.id, message: err instanceof Error ? err.message : 'Failed' });
    } finally { setActionLoading(null); }
  }, [incident.id, resolveNote, resolveCategory, skipVerification, onUpdate]);

  const allRerunsPass = useMemo(() =>
    rerunResults.length > 0 && rerunResults.every(r => r.status === 'Success'),
    [rerunResults],
  );

  const omTableUrl = incident.blast_radius ? `${omBaseUrl}/table/${incident.blast_radius.root_cause_table}` : null;
  const omDqUrl = incident.blast_radius ? `${omBaseUrl}/table/${incident.blast_radius.root_cause_table}/profiler/data-quality` : null;

  // ── Render ──
  return (
    <div className="animate-fade-in">
      {/* ═══ Header ═══ */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={onBack} className="flex items-center gap-1.5 text-content-muted hover:text-content-primary transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
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

      {/* ═══ Action Bar ═══ */}
      <div className="flex flex-wrap gap-3 mb-8">
        {incident.status !== 'acknowledged' && incident.status !== 'resolved' && (
          <ActionButton onClick={handleAcknowledge} loading={actionLoading === 'ack'} icon={<Check className="w-4 h-4" />} label="Acknowledge" variant="purple" />
        )}
        <div className="relative">
          <ActionButton onClick={() => setShowAssignDropdown(!showAssignDropdown)} loading={actionLoading === 'assign'} icon={<UserPlus className="w-4 h-4" />} label={incident.assigned_to ? `Assigned: ${incident.assigned_to}` : 'Assign'} variant="blue" trailing={<ChevronDown className="w-3 h-3" />} />
          {showAssignDropdown && <AssignDropdown users={users} search={userSearch} onSearch={setUserSearch} onSelect={(u) => { handleAssign(u); setUserSearch(''); }} onClose={() => setShowAssignDropdown(false)} />}
        </div>

        {incident.status !== 'resolved' && (
          <>
            <ActionButton onClick={handleSuggestFix} loading={fixStep === 'suggesting'} icon={<Wrench className="w-4 h-4" />} label="Fix & Resolve" variant="amber" />
            <ActionButton onClick={() => { setShowResolveModal(true); setResolveResult(null); setPreVerifyResult(null); }} loading={actionLoading === 'resolve'} icon={<CheckCircle className="w-4 h-4" />} label="Resolve" variant="green" />
          </>
        )}

        <div className="flex-1" />
        {omDqUrl && <ExtLink href={omDqUrl} icon={<Shield className="w-4 h-4" />} label="DQ Tests" className="border-warning/30 text-warning hover:bg-warning/10" />}
        {omTableUrl && <ExtLink href={omTableUrl} icon={<OpenMetadataIcon className="w-4 h-4" />} label="OpenMetadata" className="border-border-subtle text-content-muted hover:text-content-primary hover:bg-surface-soft" />}
        {incident.slack_thread_url && <ExtLink href={incident.slack_thread_url} icon={<SlackIcon className="w-4 h-4" />} label="Slack" className="border-primary-500/30 text-primary-400 hover:bg-primary-500/10" />}
      </div>

      {/* ═══ Fix & Resolve Wizard (inline, not modal) ═══ */}
      {fixStep !== 'idle' && incident.status !== 'resolved' && (
        <FixWizard
          fixStep={fixStep}
          suggestions={fixSuggestions}
          fixResult={fixResult}
          rerunResults={rerunResults}
          preVerifyResult={preVerifyResult}
          preVerifyLoading={preVerifyLoading}
          allRerunsPass={allRerunsPass}
          incident={incident}
          resolveNote={resolveNote}
          resolveCategory={resolveCategory}
          skipVerification={skipVerification}
          resolveResult={resolveResult}
          actionLoading={actionLoading}
          guardrailResults={guardrailResults}
          guardrailLoading={guardrailLoading}
          onExecute={handleExecuteFix}
          onRerun={handleRerunTests}
          onPreVerify={handlePreVerify}
          onAddGuardrail={handleAddGuardrail}
          onResolveNoteChange={setResolveNote}
          onResolveCategoryChange={setResolveCategory}
          onSkipVerificationChange={setSkipVerification}
          onResolve={handleResolve}
          onClose={() => setFixStep('idle')}
        />
      )}

      {/* ═══ Resolve Modal (manual resolve without fix wizard) ═══ */}
      {showResolveModal && <ResolveModal
        incident={incident}
        resolveNote={resolveNote}
        resolveCategory={resolveCategory}
        skipVerification={skipVerification}
        resolveResult={resolveResult}
        preVerifyResult={preVerifyResult}
        preVerifyLoading={preVerifyLoading}
        actionLoading={actionLoading}
        onResolveNoteChange={setResolveNote}
        onResolveCategoryChange={setResolveCategory}
        onSkipVerificationChange={setSkipVerification}
        onPreVerify={handlePreVerify}
        onResolve={handleResolve}
        onClose={() => setShowResolveModal(false)}
      />}

      {/* ═══ Content Grid ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {incident.report ? (
            <ReportCard report={incident.report} />
          ) : incident.report_generating ? (
            <ReportLoadingCard />
          ) : null}
          {incident.blast_radius && <LineageCard blastRadius={incident.blast_radius} omBaseUrl={omBaseUrl} />}
          {incident.failure_histories.length > 0 && (
            <GlassCard icon={<Shield className="w-4 h-4 text-warning" />} iconBg="bg-warning/15" title="Failure History">
              <div className="space-y-4">
                {incident.failure_histories.map((h) => <FailureHistoryChart key={h.test_case_name} history={h} />)}
              </div>
            </GlassCard>
          )}
          {incident.events && incident.events.length > 0 && <TimelineCard events={incident.events} title={incident.title} createdAt={incident.created_at} />}
        </div>

        {/* ── Right Sidebar ── */}
        <div className="space-y-6">
          <FailedTestsCard failures={incident.failures} />
          {incident.blast_radius && <AffectedAssetsCard blastRadius={incident.blast_radius} omBaseUrl={omBaseUrl} />}
          {incident.verification_result && <VerificationCard result={incident.verification_result} />}
          {incident.acknowledged_by && incident.acknowledged_at && (
            <StatusCard color="primary" icon="\u2713" title="Acknowledged" by={incident.acknowledged_by} at={incident.acknowledged_at} />
          )}
          {incident.resolved_at && (
            <div className="rounded-xl border border-success/20 bg-success/5 p-5">
              <h4 className="text-sm font-semibold text-success mb-2">&check; Resolved</h4>
              <p className="text-sm text-content-secondary">{incident.resolution_note}</p>
              {incident.resolution_category && <p className="text-xs text-content-muted mt-1.5">Category: <span className="font-medium text-content-primary">{incident.resolution_category}</span></p>}
              {incident.resolved_by && <p className="text-xs text-content-muted mt-1">by <span className="text-content-primary font-medium">{incident.resolved_by}</span></p>}
              <p className="text-xs text-content-faint mt-1">{new Date(incident.resolved_at).toLocaleString()}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   FIX & RESOLVE WIZARD — The core in-platform DQ resolution workflow
   ═══════════════════════════════════════════════════════════════════════ */

interface FixWizardProps {
  fixStep: FixStep;
  suggestions: FixSuggestion[];
  fixResult: { success: boolean; message: string; rows_affected: number } | null;
  rerunResults: RerunResult[];
  preVerifyResult: { passed: boolean; message: string } | null;
  preVerifyLoading: boolean;
  allRerunsPass: boolean;
  incident: IncidentDetail;
  resolveNote: string;
  resolveCategory: string;
  skipVerification: boolean;
  resolveResult: ResolveResponse | null;
  actionLoading: string | null;
  guardrailResults: Record<number, GuardrailResult>;
  guardrailLoading: number | null;
  onExecute: (sql: string) => void;
  onRerun: () => void;
  onPreVerify: () => void;
  onAddGuardrail: (suggestion: FixSuggestion, idx: number) => void;
  onResolveNoteChange: (v: string) => void;
  onResolveCategoryChange: (v: string) => void;
  onSkipVerificationChange: (v: boolean) => void;
  onResolve: () => void;
  onClose: () => void;
}

/* ── Reusable data fix group (root cause or symptom) ── */
function DataFixGroup({ label, sublabel, badge, badgeClass, accentClass, borderClass, sqlClass, buttonClass, icon, fixes, onExecute }: {
  label: string;
  sublabel: string;
  badge: string;
  badgeClass: string;
  accentClass: string;
  borderClass: string;
  sqlClass: string;
  buttonClass: string;
  icon: React.ReactNode;
  fixes: FixSuggestion[];
  onExecute: (sql: string) => void;
}) {
  const [localIdx, setLocalIdx] = useState(0);
  const [localSql, setLocalSql] = useState(fixes[0]?.sql ?? '');

  const selected = fixes[localIdx] ?? fixes[0] ?? null;
  if (!selected) return null;

  const handleSelect = (i: number) => {
    setLocalIdx(i);
    setLocalSql(fixes[i]?.sql ?? '');
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h4 className={`text-sm font-semibold ${accentClass}`}>{label}</h4>
        <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full border ${badgeClass}`}>{badge}</span>
      </div>
      <p className="text-xs text-content-faint mb-3">{sublabel}</p>

      {fixes.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {fixes.map((s, i) => (
            <button key={i} onClick={() => handleSelect(i)} className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${i === localIdx ? `${borderClass.split(' ')[0]} bg-current/10 ${accentClass}` : `border-border-subtle text-content-muted hover:${borderClass.split(' ')[0]}`}`}>
              {s.description.replace('[Root Cause] ', '').slice(0, 40)}{s.description.length > 40 ? '…' : ''}
            </button>
          ))}
        </div>
      )}

      <div className={`bg-surface-inset rounded-xl p-4 border ${borderClass.split(' ')[0]}`}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className={`w-3.5 h-3.5 ${accentClass}`} />
              <span className="text-sm font-medium text-content-primary">{selected.description}</span>
            </div>
            <p className="text-xs text-content-muted">{selected.impact_summary}</p>
          </div>
          <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${selected.risk_level === 'low' ? 'bg-success/10 text-success' : selected.risk_level === 'medium' ? 'bg-warning/10 text-warning' : 'bg-danger/10 text-danger'}`}>
            {selected.risk_level} risk
          </span>
        </div>
        <div className="text-xs text-content-faint mb-2 flex items-center gap-1">
          <Code className="w-3 h-3" /> SQL (editable)
        </div>
        <textarea
          value={localSql}
          onChange={(e) => setLocalSql(e.target.value)}
          className={`w-full h-24 bg-black/30 border border-border-subtle rounded-lg p-3 font-mono text-xs ${sqlClass} resize-none focus:outline-none`}
          spellCheck={false}
        />
        <p className="text-xs text-content-faint mt-1.5">~{selected.rows_affected_estimate} rows estimated</p>
      </div>

      <button onClick={() => onExecute(localSql)} className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold ${buttonClass} text-black rounded-xl transition-colors mt-3`}>
        <Zap className="w-4 h-4" /> Apply Fix
      </button>
    </div>
  );
}

function FixWizard(props: FixWizardProps) {
  const { fixStep, suggestions, fixResult, rerunResults, allRerunsPass, incident, guardrailResults, guardrailLoading } = props;

  const dataFixes = useMemo(() => suggestions.filter((s) => s.fix_type === 'data_fix'), [suggestions]);
  const rootCauseFixes = useMemo(() => dataFixes.filter((s) => s.fix_target === 'root_cause'), [dataFixes]);
  const symptomFixes = useMemo(() => dataFixes.filter((s) => s.fix_target !== 'root_cause'), [dataFixes]);
  const guardrails = useMemo(() => suggestions.filter((s) => s.fix_type === 'guardrail'), [suggestions]);

  // Map guardrail index in full suggestions array
  const guardrailGlobalIdx = useCallback((localIdx: number) => {
    let count = 0;
    for (let i = 0; i < suggestions.length; i++) {
      const s = suggestions[i];
      if (s && s.fix_type === 'guardrail') {
        if (count === localIdx) return i;
        count++;
      }
    }
    return -1;
  }, [suggestions]);

  // Steps reflect new dual-path flow
  const anyGuardrailAdded = Object.values(guardrailResults).some((r) => r.success);
  const steps = [
    { key: 'analyze', label: 'Analyze', done: fixStep !== 'suggesting' && suggestions.length > 0 },
    { key: 'action', label: 'Fix / Guard', done: fixResult?.success === true || anyGuardrailAdded },
    { key: 'rerun', label: 'Re-test', done: rerunResults.length > 0 },
    { key: 'resolve', label: 'Resolve', done: false },
  ];

  return (
    <div className="mb-8 rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-transparent overflow-hidden animate-slide-up">
      {/* Header + stepper */}
      <div className="flex items-center justify-between px-6 pt-5 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/15">
            <Wrench className="w-4 h-4 text-amber-400" />
          </div>
          <h3 className="text-base font-semibold text-content-primary">Fix &amp; Resolve</h3>
        </div>
        <div className="flex items-center gap-1">
          {steps.map((s, i) => (
            <div key={s.key} className="flex items-center">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${s.done ? 'bg-success text-black' : 'bg-surface-inset text-content-faint border border-border-subtle'}`}>
                {s.done ? <Check className="w-3 h-3" /> : i + 1}
              </div>
              <span className={`text-xs mx-1.5 ${s.done ? 'text-success' : 'text-content-faint'}`}>{s.label}</span>
              {i < steps.length - 1 && <div className={`w-6 h-px ${s.done ? 'bg-success' : 'bg-border-subtle'}`} />}
            </div>
          ))}
        </div>
        <button onClick={props.onClose} className="text-content-muted hover:text-content-primary transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="px-6 pb-6">
        {/* Loading */}
        {fixStep === 'suggesting' && (
          <div className="flex items-center gap-3 py-8 justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
            <span className="text-sm text-content-secondary">Analyzing failures and generating fixes + guardrails...</span>
          </div>
        )}

        {/* ── Review: dual-path — Data Fixes + Guardrails ── */}
        {fixStep === 'review' && (
          <div className="space-y-5">
            {/* Failure context */}
            <div className="bg-danger/5 border border-danger/20 rounded-xl p-3.5">
              <h4 className="text-xs font-semibold text-danger uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Root Cause Failures
              </h4>
              <div className="space-y-1">
                {incident.failures.map((f) => (
                  <div key={f.test_case_id} className="text-xs">
                    <span className="font-medium text-content-primary">{f.test_case_name}</span>
                    <span className="text-content-faint"> on </span>
                    <span className="text-content-muted">{f.table_fqn.split('.').pop()}</span>
                    {f.column && <span className="text-content-faint"> &rarr; {f.column}</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* ─── Guardrails Section (FIRST — the primary path) ─── */}
            {guardrails.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <ShieldPlus className="w-4 h-4 text-teal-400" />
                  <h4 className="text-sm font-semibold text-teal-400">Add Guardrails to OpenMetadata</h4>
                  <span className="text-xs text-content-faint">Prevent recurrence with DQ test cases</span>
                </div>
                <div className="space-y-2.5">
                  {guardrails.map((g, localIdx) => {
                    const globalIdx = guardrailGlobalIdx(localIdx);
                    const result = guardrailResults[globalIdx];
                    const isLoading = guardrailLoading === globalIdx;

                    return (
                      <div key={localIdx} className="bg-surface-inset rounded-xl p-4 border border-teal-500/20 hover:border-teal-500/40 transition-colors">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Shield className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" />
                              <span className="text-sm font-medium text-content-primary">{g.description}</span>
                            </div>
                            <p className="text-xs text-content-muted">{g.impact_summary}</p>
                            <div className="flex items-center gap-3 mt-2">
                              <span className="text-xs text-teal-400/80 font-mono bg-teal-500/10 px-2 py-0.5 rounded">{g.test_definition}</span>
                              {g.parameter_values.length > 0 && (
                                <span className="text-xs text-content-faint">
                                  {g.parameter_values.map((p) => `${p.name}=${p.value}`).join(', ')}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex-shrink-0 ml-3">
                            {result?.success ? (
                              <span className="flex items-center gap-1.5 text-xs text-success font-medium">
                                <CheckCircle className="w-3.5 h-3.5" /> Created
                              </span>
                            ) : result && !result.success ? (
                              <span className="text-xs text-danger">{result.message}</span>
                            ) : (
                              <button
                                onClick={() => props.onAddGuardrail(g, globalIdx)}
                                disabled={isLoading}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-teal-500 text-black rounded-lg hover:bg-teal-400 disabled:opacity-50 transition-colors"
                              >
                                {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                                Add to OM
                              </button>
                            )}
                          </div>
                        </div>
                        {result?.success && result.om_link && (
                          <a href={result.om_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-teal-400 hover:text-teal-300 mt-1 transition-colors">
                            <ExternalLink className="w-3 h-3" /> View in OpenMetadata
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Divider */}
            {guardrails.length > 0 && dataFixes.length > 0 && (
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border-subtle" />
                <span className="text-xs text-content-faint uppercase tracking-wider">or also fix existing data</span>
                <div className="flex-1 h-px bg-border-subtle" />
              </div>
            )}

            {/* ─── Root Cause Fixes (recommended) ─── */}
            {rootCauseFixes.length > 0 && (
              <DataFixGroup
                label="Fix Root Cause"
                sublabel="Fix the source table — prevents re-corruption on next pipeline run"
                badge="Recommended"
                badgeClass="bg-success/15 text-success border-success/30"
                accentClass="text-emerald-400"
                borderClass="border-emerald-500/20 hover:border-emerald-500/40"
                sqlClass="text-emerald-300 focus:border-emerald-500/50"
                buttonClass="bg-emerald-500 hover:bg-emerald-400"
                icon={<Wrench className="w-4 h-4 text-emerald-400" />}
                fixes={rootCauseFixes}
                onExecute={props.onExecute}
              />
            )}

            {/* ─── Symptom Treatments (quick patch) ─── */}
            {symptomFixes.length > 0 && (
              <>
                {rootCauseFixes.length > 0 && (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-border-subtle" />
                    <span className="text-xs text-content-faint uppercase tracking-wider">or treat downstream symptoms</span>
                    <div className="flex-1 h-px bg-border-subtle" />
                  </div>
                )}
                {rootCauseFixes.length > 0 && (
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-amber-400">Symptom fixes are temporary</p>
                      <p className="text-xs text-content-muted mt-0.5">These patch downstream tables directly. Data will re-corrupt on the next pipeline run unless the root cause is also fixed.</p>
                    </div>
                  </div>
                )}
                <DataFixGroup
                  label="Treat Symptoms"
                  sublabel="Patch downstream tables now — quick fix for dashboards"
                  badge="Temporary"
                  badgeClass="bg-amber-500/15 text-amber-400 border-amber-500/30"
                  accentClass="text-amber-400"
                  borderClass="border-amber-500/20 hover:border-amber-500/40"
                  sqlClass="text-amber-300 focus:border-amber-500/50"
                  buttonClass="bg-amber-500 hover:bg-amber-400"
                  icon={<Zap className="w-4 h-4 text-amber-400" />}
                  fixes={symptomFixes}
                  onExecute={props.onExecute}
                />
              </>
            )}

            {/* Skip to re-test if only guardrails were added */}
            {anyGuardrailAdded && (
              <button onClick={props.onRerun} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold border border-secondary-500/30 text-secondary-400 rounded-xl hover:bg-secondary-500/10 transition-colors">
                <Play className="w-4 h-4" /> Skip to Re-run Tests
              </button>
            )}
          </div>
        )}

        {/* Executing */}
        {fixStep === 'executing' && (
          <div className="flex items-center gap-3 py-8 justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
            <span className="text-sm text-content-secondary">Executing SQL fix against the database...</span>
          </div>
        )}

        {/* Executed — result + re-run */}
        {fixStep === 'executed' && fixResult && (
          <div className="space-y-4">
            <div className={`rounded-xl p-4 border ${fixResult.success ? 'border-success/20 bg-success/5' : 'border-danger/20 bg-danger/5'}`}>
              <div className="flex items-center gap-2 mb-1">
                {fixResult.success ? <CheckCircle className="w-4 h-4 text-success" /> : <ShieldX className="w-4 h-4 text-danger" />}
                <span className={`text-sm font-semibold ${fixResult.success ? 'text-success' : 'text-danger'}`}>
                  {fixResult.success ? 'Fix Applied' : 'Fix Failed'}
                </span>
              </div>
              <p className="text-xs text-content-secondary">{fixResult.message}</p>
            </div>

            {fixResult.success && (
              <button onClick={props.onRerun} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold bg-secondary-500 text-white rounded-xl hover:bg-secondary-400 transition-colors">
                <Play className="w-4 h-4" /> Re-run DQ Tests
              </button>
            )}
          </div>
        )}

        {/* Re-running */}
        {fixStep === 'rerunning' && (
          <div className="flex items-center gap-3 py-8 justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-secondary-400" />
            <span className="text-sm text-content-secondary">Re-running DQ test cases...</span>
          </div>
        )}

        {/* Re-run results + resolve */}
        {fixStep === 'rerun_done' && (
          <div className="space-y-4">
            <div className="space-y-2">
              {rerunResults.map((r) => (
                <div key={r.test_case_name} className={`flex items-center gap-3 rounded-xl p-3 border ${r.status === 'Success' ? 'border-success/20 bg-success/5' : 'border-danger/20 bg-danger/5'}`}>
                  {r.status === 'Success' ? <CheckCircle className="w-4 h-4 text-success flex-shrink-0" /> : <ShieldX className="w-4 h-4 text-danger flex-shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-content-primary">{r.test_case_name}</p>
                    <p className="text-xs text-content-muted truncate">{r.message}</p>
                  </div>
                  <span className={`text-xs font-semibold ${r.status === 'Success' ? 'text-success' : 'text-danger'}`}>{r.status}</span>
                </div>
              ))}
            </div>

            {allRerunsPass && (
              <div className="bg-success/5 border border-success/20 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <ShieldCheck className="w-5 h-5 text-success" />
                  <h4 className="text-sm font-semibold text-success">All Tests Passing!</h4>
                </div>
                <p className="text-xs text-content-secondary mb-4">All DQ tests are passing. Complete the resolution below.</p>

                <div className="space-y-3">
                  <select value={props.resolveCategory} onChange={(e) => props.onResolveCategoryChange(e.target.value)} className="w-full bg-surface-inset border border-border-subtle rounded-lg px-3 py-2 text-sm text-content-primary focus:outline-none focus:border-success/50">
                    {RESOLUTION_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  <textarea
                    value={props.resolveNote}
                    onChange={(e) => props.onResolveNoteChange(e.target.value)}
                    placeholder="Describe what was fixed..."
                    className="w-full h-20 bg-surface-inset border border-border-subtle rounded-lg p-3 text-sm text-content-primary placeholder-content-faint focus:outline-none focus:border-success/50 resize-none"
                  />
                  <button
                    onClick={props.onResolve}
                    disabled={!props.resolveNote.trim() || props.actionLoading === 'resolve'}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold bg-success text-black rounded-xl hover:bg-success-soft disabled:opacity-50 transition-colors"
                  >
                    {props.actionLoading === 'resolve' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <CheckCircle className="w-4 h-4" /> Verify &amp; Resolve
                  </button>
                </div>

                {props.resolveResult && props.resolveResult.status === 'rejected' && (
                  <div className="mt-3 bg-danger/5 border border-danger/20 rounded-lg p-3">
                    <p className="text-xs text-danger font-medium">{props.resolveResult.message}</p>
                  </div>
                )}
              </div>
            )}

            {!allRerunsPass && (
              <div className="bg-danger/5 border border-danger/20 rounded-xl p-4">
                <p className="text-sm text-danger font-medium mb-2">Some tests are still failing.</p>
                <p className="text-xs text-content-muted mb-3">You can try a different fix or resolve manually.</p>
                <div className="flex gap-2">
                  <button onClick={() => { props.onClose(); }} className="px-3 py-1.5 text-xs border border-amber-500/30 text-amber-400 rounded-lg hover:bg-amber-500/10 transition-colors">
                    Try Another Fix
                  </button>
                  <button onClick={props.onRerun} className="px-3 py-1.5 text-xs border border-secondary-500/30 text-secondary-400 rounded-lg hover:bg-secondary-500/10 transition-colors">
                    Re-run Again
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   RESOLVE MODAL — Manual resolution without the fix wizard
   ═══════════════════════════════════════════════════════════════════════ */

interface ResolveModalProps {
  incident: IncidentDetail;
  resolveNote: string;
  resolveCategory: string;
  skipVerification: boolean;
  resolveResult: ResolveResponse | null;
  preVerifyResult: { passed: boolean; message: string } | null;
  preVerifyLoading: boolean;
  actionLoading: string | null;
  onResolveNoteChange: (v: string) => void;
  onResolveCategoryChange: (v: string) => void;
  onSkipVerificationChange: (v: boolean) => void;
  onPreVerify: () => void;
  onResolve: () => void;
  onClose: () => void;
}

function ResolveModal(props: ResolveModalProps) {
  const { incident, resolveNote, resolveCategory, skipVerification, resolveResult, preVerifyResult, preVerifyLoading, actionLoading } = props;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-elevated border border-border-subtle rounded-2xl w-full max-w-lg shadow-card animate-slide-up max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h3 className="text-lg font-semibold text-content-primary">Resolve Incident</h3>
          <button onClick={props.onClose} className="text-content-muted hover:text-content-primary transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-5 space-y-4">
          {/* Failure context */}
          <div className="bg-danger/5 border border-danger/20 rounded-xl p-3.5">
            <h4 className="text-xs font-semibold text-danger uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Original Failures
            </h4>
            <div className="space-y-1.5">
              {incident.failures.map((f) => (
                <div key={f.test_case_id} className="text-xs">
                  <span className="font-medium text-content-primary">{f.test_case_name}</span>
                  <span className="text-content-faint"> on </span>
                  <span className="text-content-muted">{f.table_fqn.split('.').pop()}</span>
                  <p className="text-danger/80 mt-0.5 truncate">{f.result_message}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Pre-verify */}
          <div className="flex items-center gap-3">
            <button onClick={props.onPreVerify} disabled={preVerifyLoading} className="flex items-center gap-2 px-3 py-1.5 text-xs border border-secondary-500/30 text-secondary-400 hover:bg-secondary-500/10 rounded-lg transition-all disabled:opacity-50">
              {preVerifyLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              Check if tests pass
            </button>
            {preVerifyResult && (
              <span className={`text-xs font-medium ${preVerifyResult.passed ? 'text-success' : 'text-danger'}`}>
                {preVerifyResult.passed ? '\u2713 All passing' : '\u2717 Still failing'}
              </span>
            )}
          </div>

          {/* Category + Note */}
          <select value={resolveCategory} onChange={(e) => props.onResolveCategoryChange(e.target.value)} className="w-full bg-surface-inset border border-border-subtle rounded-xl px-3 py-2 text-sm text-content-primary focus:outline-none focus:border-success/50">
            {RESOLUTION_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <textarea value={resolveNote} onChange={(e) => props.onResolveNoteChange(e.target.value)} placeholder="Describe what was fixed..." className="w-full h-28 bg-surface-inset border border-border-subtle rounded-xl p-3 text-sm text-content-primary placeholder-content-faint focus:outline-none focus:border-success/50 resize-none" />

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={skipVerification} onChange={(e) => props.onSkipVerificationChange(e.target.checked)} className="w-4 h-4 rounded border-border-subtle accent-warning" />
            <span className="text-xs text-content-muted">Skip DQ verification (force resolve)</span>
          </label>

          {resolveResult && resolveResult.status === 'rejected' && (
            <div className="bg-danger/5 border border-danger/20 rounded-xl p-4 animate-slide-up">
              <div className="flex items-center gap-2 mb-2">
                <ShieldX className="w-4 h-4 text-danger" />
                <h4 className="text-sm font-semibold text-danger">Resolution Rejected</h4>
              </div>
              <p className="text-xs text-content-secondary">{resolveResult.message}</p>
              {resolveResult.still_failing_tests && resolveResult.still_failing_tests.length > 0 && (
                <div className="mt-2">
                  {resolveResult.still_failing_tests.map((t) => <p key={t} className="text-xs text-danger">&bull; {t}</p>)}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border-subtle">
          <button onClick={props.onClose} className="px-4 py-2 text-sm text-content-muted hover:text-content-primary transition-colors">Cancel</button>
          <button onClick={props.onResolve} disabled={!resolveNote.trim() || actionLoading === 'resolve'} className="px-5 py-2 text-sm font-semibold bg-success text-black rounded-xl hover:bg-success-soft disabled:opacity-50 transition-colors flex items-center gap-2">
            {actionLoading === 'resolve' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {skipVerification ? 'Force Resolve' : 'Verify & Resolve'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   SUBCOMPONENTS — Cards, timeline, buttons
   ═══════════════════════════════════════════════════════════════════════ */

function GlassCard({ children, icon, iconBg, title }: { children: React.ReactNode; icon: React.ReactNode; iconBg: string; title: string }) {
  return (
    <section className="relative overflow-hidden rounded-xl border border-border-subtle bg-surface-elevated p-6">
      <div className="absolute inset-0 bg-noise opacity-20 pointer-events-none" />
      <div className="relative z-10">
        <h3 className="flex items-center gap-2 text-base font-semibold text-content-primary mb-5">
          <span className={`flex items-center justify-center w-7 h-7 rounded-lg ${iconBg}`}>{icon}</span>
          {title}
        </h3>
        {children}
      </div>
    </section>
  );
}

function ReportLoadingCard() {
  return (
    <GlassCard icon={<Sparkles className="w-4 h-4 text-primary-400 animate-pulse" />} iconBg="bg-primary-500/15" title="AI Incident Report">
      <div className="flex items-center gap-3 py-8 justify-center text-content-muted">
        <Loader2 className="w-5 h-5 animate-spin text-primary-400" />
        <span className="text-sm">Generating AI report in background…</span>
      </div>
      <div className="space-y-3 animate-pulse">
        <div className="h-3 bg-surface-2 rounded w-full" />
        <div className="h-3 bg-surface-2 rounded w-5/6" />
        <div className="h-3 bg-surface-2 rounded w-4/6" />
        <div className="h-3 bg-surface-2 rounded w-full mt-4" />
        <div className="h-3 bg-surface-2 rounded w-3/4" />
      </div>
    </GlassCard>
  );
}

function ReportCard({ report }: { report: IncidentDetail['report'] }) {
  if (!report) return null;

  const [activeSection, setActiveSection] = useState<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const sections = useMemo(() => {
    const s: { id: string; label: string; icon: React.ReactNode; color: string; content: React.ReactNode }[] = [
      { id: 'summary', label: 'Summary', icon: <FileText className="w-3.5 h-3.5" />, color: 'text-primary-400 border-primary-500/30 bg-primary-500/10', content: <p>{report.summary}</p> },
      { id: 'root-cause', label: 'Root Cause Analysis', icon: <Search className="w-3.5 h-3.5" />, color: 'text-danger border-danger/30 bg-danger/10', content: <p>{report.root_cause_analysis}</p> },
      { id: 'blast-radius', label: 'Blast Radius', icon: <Zap className="w-3.5 h-3.5" />, color: 'text-warning border-warning/30 bg-warning/10', content: <p>{report.blast_radius_description}</p> },
    ];
    if (report.stakeholders_affected) {
      s.push({ id: 'stakeholders', label: 'Stakeholders', icon: <Users className="w-3.5 h-3.5" />, color: 'text-secondary-400 border-secondary-500/30 bg-secondary-500/10', content: <p>{report.stakeholders_affected}</p> });
    }
    if (report.trend_analysis) {
      s.push({ id: 'trend', label: 'Trend', icon: <TrendingUp className="w-3.5 h-3.5" />, color: 'text-teal-400 border-teal-500/30 bg-teal-500/10', content: <p>{report.trend_analysis}</p> });
    }
    if (report.recommendations.length > 0) {
      s.push({
        id: 'recommendations',
        label: 'Recommendations',
        icon: <Lightbulb className="w-3.5 h-3.5" />,
        color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
        content: (
          <ol className="list-decimal list-inside space-y-2">
            {report.recommendations.map((r, i) => <li key={i}>{r}</li>)}
          </ol>
        ),
      });
    }
    return s;
  }, [report]);

  const scrollToSection = useCallback((id: string) => {
    const el = sectionRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setActiveSection(id);
      setTimeout(() => setActiveSection(null), 2000);
    }
  }, []);

  return (
    <GlassCard icon={<FileText className="w-4 h-4 text-primary-400" />} iconBg="bg-primary-500/15" title="AI Incident Report">
      {/* ── Table of Contents ── */}
      <div className="flex flex-wrap gap-2 mb-6 pb-4 border-b border-border-subtle">
        {sections.map((sec) => (
          <button
            key={sec.id}
            onClick={() => scrollToSection(sec.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all hover:scale-[1.03] ${sec.color}`}
          >
            {sec.icon}
            {sec.label}
          </button>
        ))}
      </div>

      {/* ── Sections ── */}
      <div className="space-y-6 text-sm text-content-secondary leading-relaxed">
        {sections.map((sec) => (
          <div
            key={sec.id}
            ref={(el) => { sectionRefs.current[sec.id] = el; }}
            className={`rounded-xl border p-4 transition-all duration-500 ${
              activeSection === sec.id
                ? `${sec.color} ring-1 ring-current shadow-lg`
                : 'border-border-subtle bg-surface-inset'
            }`}
          >
            <h4 className={`flex items-center gap-2 text-sm font-semibold mb-2.5 ${sec.color.split(' ')[0]}`}>
              {sec.icon}
              {sec.label}
            </h4>
            <div className={activeSection === sec.id ? 'text-content-primary' : ''}>
              {sec.content}
            </div>
          </div>
        ))}
      </div>

      {/* ── Generated timestamp ── */}
      <p className="text-xs text-content-faint mt-5 pt-3 border-t border-border-subtle flex items-center gap-1.5">
        <Sparkles className="w-3 h-3" />
        Generated {new Date(report.generated_at).toLocaleString()}
      </p>
    </GlassCard>
  );
}

function LineageCard({ blastRadius, omBaseUrl }: { blastRadius: IncidentDetail['blast_radius']; omBaseUrl: string }) {
  if (!blastRadius) return null;
  return (
    <GlassCard icon={<GitBranch className="w-4 h-4 text-primary-400" />} iconBg="bg-primary-500/15" title="Blast Radius & Lineage">
      <LineageGraph blastRadius={blastRadius} omBaseUrl={omBaseUrl} />
    </GlassCard>
  );
}

function TimelineCard({ events, title, createdAt }: { events: IncidentDetail['events']; title: string; createdAt: string }) {
  return (
    <GlassCard icon={<Clock className="w-4 h-4 text-secondary-400" />} iconBg="bg-secondary-500/15" title="Incident Timeline">
      <div className="relative pl-6">
        <div className="absolute left-[9px] top-1 bottom-1 w-px bg-border-subtle" />
        <div className="space-y-3">
          <TimelineEntry action="created" actor="system" detail={title} timestamp={createdAt} />
          {events.map((evt, i) => <TimelineEntry key={i} action={evt.action} actor={evt.actor} detail={evt.detail} timestamp={evt.timestamp} />)}
        </div>
      </div>
    </GlassCard>
  );
}

function FailedTestsCard({ failures }: { failures: IncidentDetail['failures'] }) {
  return (
    <section className="rounded-xl border border-border-subtle bg-surface-elevated p-5">
      <SectionLabel>Failed Tests</SectionLabel>
      <div className="space-y-3 mt-3">
        {failures.map((f) => (
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
    </section>
  );
}

function AffectedAssetsCard({ blastRadius, omBaseUrl }: { blastRadius: NonNullable<IncidentDetail['blast_radius']>; omBaseUrl: string }) {
  return (
    <section className="rounded-xl border border-border-subtle bg-surface-elevated p-5">
      <SectionLabel>Affected Assets ({blastRadius.total_affected_assets})</SectionLabel>
      <div className="space-y-2 mt-3">
        {[...blastRadius.upstream_chain, ...blastRadius.downstream_impact].map((asset) => {
          const shortName = asset.fqn.split('.').pop() ?? asset.fqn;
          return (
            <a key={asset.fqn} href={`${omBaseUrl}/table/${asset.fqn}`} target="_blank" rel="noopener noreferrer" className="block bg-surface-inset rounded-xl p-3 border border-border-subtle hover:border-primary-500/30 transition-all">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-content-primary font-medium">{shortName}</span>
                <ExternalLink className="w-3 h-3 text-content-faint" />
              </div>
              {asset.tier && <span className="inline-block text-xs px-1.5 py-0.5 bg-primary-500/10 text-primary-400 border border-primary-500/20 rounded-lg mr-2">{asset.tier.replace('Tier.', '')}</span>}
              {asset.owners.length > 0 && <span className="text-xs text-content-muted">Owner: {asset.owners.join(', ')}</span>}
            </a>
          );
        })}
      </div>
    </section>
  );
}

function VerificationCard({ result }: { result: NonNullable<IncidentDetail['verification_result']> }) {
  return (
    <div className={`rounded-xl border p-5 ${result.passed ? 'border-success/20 bg-success/5' : 'border-danger/20 bg-danger/5'}`}>
      <h4 className={`text-sm font-semibold mb-2 flex items-center gap-2 ${result.passed ? 'text-success' : 'text-danger'}`}>
        {result.passed ? <ShieldCheck className="w-4 h-4" /> : <ShieldX className="w-4 h-4" />}
        DQ Verification
      </h4>
      <p className="text-sm text-content-secondary">{result.message}</p>
      {result.note_alignment && (
        <div className="mt-2 pt-2 border-t border-border-subtle">
          <p className="text-xs text-content-muted">
            Note alignment: <span className={`font-semibold ${result.note_alignment.confidence === 'HIGH' ? 'text-success' : result.note_alignment.confidence === 'MEDIUM' ? 'text-warning' : 'text-danger'}`}>{result.note_alignment.confidence}</span>
          </p>
          <p className="text-xs text-content-faint mt-0.5">{result.note_alignment.explanation}</p>
        </div>
      )}
      <p className="text-xs text-content-faint mt-2">{new Date(result.verified_at).toLocaleString()}</p>
    </div>
  );
}

function StatusCard({ color, icon, title, by, at }: { color: string; icon: string; title: string; by: string; at: string }) {
  return (
    <div className={`rounded-xl border border-${color}-500/20 bg-${color}-500/5 p-5`}>
      <h4 className={`text-sm font-semibold text-${color}-400 mb-2`}>{icon} {title}</h4>
      <p className="text-sm text-content-secondary">by <span className="text-content-primary font-medium">{by}</span></p>
      <p className="text-xs text-content-muted mt-1">{new Date(at).toLocaleString()}</p>
    </div>
  );
}

/* ── Shared UI primitives ── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h4 className="text-xs font-semibold text-content-muted uppercase tracking-wider">{children}</h4>;
}

function ActionButton({ onClick, loading, icon, label, variant, trailing }: { onClick: () => void; loading: boolean; icon: React.ReactNode; label: string; variant: 'purple' | 'blue' | 'green' | 'amber'; trailing?: React.ReactNode }) {
  const colors = {
    purple: 'border-primary-500/30 text-primary-400 hover:bg-primary-500/10',
    blue: 'border-secondary-500/30 text-secondary-400 hover:bg-secondary-500/10',
    green: 'border-success/30 text-success hover:bg-success/10',
    amber: 'border-amber-500/30 text-amber-400 hover:bg-amber-500/10',
  };
  return (
    <button onClick={onClick} disabled={loading} className={`flex items-center gap-2 px-4 py-2 text-sm border rounded-xl transition-all disabled:opacity-50 ${colors[variant]}`}>
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}{label}{trailing}
    </button>
  );
}

function ExtLink({ href, icon, label, className }: { href: string; icon: React.ReactNode; label: string; className: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-2 px-4 py-2 text-sm border rounded-xl transition-all ${className}`}>
      {icon}{label}
    </a>
  );
}

function AssignDropdown({ users, search, onSearch, onSelect }: { users: UserInfo[]; search: string; onSearch: (v: string) => void; onSelect: (name: string) => void; onClose: () => void }) {
  const filtered = users.filter((u) => !search || u.display_name.toLowerCase().includes(search.toLowerCase()) || u.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="absolute top-full mt-1 left-0 w-64 bg-surface-elevated border border-border-subtle rounded-xl shadow-card z-10 py-1 animate-slide-up">
      <div className="px-3 py-2 border-b border-divider">
        <div className="flex items-center gap-2 bg-surface-inset border border-border-subtle rounded-lg px-2.5 py-1.5">
          <Search className="w-3.5 h-3.5 text-content-faint" />
          <input type="text" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search users\u2026" className="bg-transparent text-xs text-content-primary placeholder-content-faint focus:outline-none w-full" autoFocus />
        </div>
      </div>
      <div className="max-h-48 overflow-y-auto">
        {filtered.map((u) => (
          <button key={u.name} onClick={() => onSelect(u.name)} className="w-full text-left px-4 py-2 text-sm text-content-secondary hover:text-content-primary hover:bg-surface-soft flex items-center gap-2 transition-colors">
            <User className="w-3.5 h-3.5 text-content-faint" />{u.display_name}
          </button>
        ))}
      </div>
    </div>
  );
}

const EVENT_CONFIG: Record<string, { icon: string; color: string }> = {
  created: { icon: '\ud83d\udfe2', color: 'text-secondary-400' },
  detected: { icon: '\ud83d\udd0d', color: 'text-content-muted' },
  investigating: { icon: '\ud83d\udd0e', color: 'text-secondary-400' },
  reported: { icon: '\ud83d\udcdd', color: 'text-primary-400' },
  acknowledged: { icon: '\u2705', color: 'text-primary-400' },
  assigned: { icon: '\ud83d\udc64', color: 'text-secondary-400' },
  fix_suggested: { icon: '\ud83d\udca1', color: 'text-amber-400' },
  fix_applied: { icon: '\ud83d\udd27', color: 'text-amber-400' },
  fix_failed: { icon: '\u274c', color: 'text-danger' },
  guardrail_added: { icon: '\ud83d\udee1\ufe0f', color: 'text-teal-400' },
  test_rerun: { icon: '\ud83d\udd04', color: 'text-secondary-400' },
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  Lightbulb,
  Search,
  Sparkles,
  TrendingUp,
  User,
  UserCheck,
  Users,
  Zap,
} from 'lucide-react';
import { api } from '../api';
import type { IncidentReport, IncidentSummary } from '../types';
import { SEVERITY_CONFIG, DEFAULT_SEVERITY_CONFIG } from '../data/constants';
import { SEED_REPORTS } from '../data/seedReports';

interface ResolvedReport {
  id: string;
  title: string;
  severity: string;
  assigned_to: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  resolution_category: string | null;
  resolved_at: string | null;
  created_at: string;
  report: IncidentReport;
}

const CATEGORY_LABELS: Record<string, string> = {
  schema_change: 'Schema Change',
  data_issue: 'Data Issue',
  pipeline_bug: 'Pipeline Bug',
  config_error: 'Configuration Error',
  external_dependency: 'External Dependency',
  false_positive: 'False Positive',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function ttr(created: string, resolved: string): string {
  const diff = new Date(resolved).getTime() - new Date(created).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/* ── Expandable Report Card ── */
function ReportCard({ data }: { data: ResolvedReport }) {
  const [expanded, setExpanded] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const sev = SEVERITY_CONFIG[data.severity] ?? DEFAULT_SEVERITY_CONFIG;

  const sections = useMemo(() => {
    const r = data.report;
    const s: { id: string; label: string; icon: React.ReactNode; color: string; content: React.ReactNode }[] = [
      { id: 'summary', label: 'Summary', icon: <FileText className="w-3.5 h-3.5" />, color: 'text-primary-400 border-primary-500/30 bg-primary-500/10', content: <p>{r.summary}</p> },
      { id: 'root-cause', label: 'Root Cause', icon: <Search className="w-3.5 h-3.5" />, color: 'text-danger border-danger/30 bg-danger/10', content: <p>{r.root_cause_analysis}</p> },
      { id: 'blast-radius', label: 'Blast Radius', icon: <Zap className="w-3.5 h-3.5" />, color: 'text-warning border-warning/30 bg-warning/10', content: <p>{r.blast_radius_description}</p> },
    ];
    if (r.stakeholders_affected) {
      s.push({ id: 'stakeholders', label: 'Stakeholders', icon: <Users className="w-3.5 h-3.5" />, color: 'text-secondary-400 border-secondary-500/30 bg-secondary-500/10', content: <p>{r.stakeholders_affected}</p> });
    }
    if (r.trend_analysis) {
      s.push({ id: 'trend', label: 'Trend', icon: <TrendingUp className="w-3.5 h-3.5" />, color: 'text-teal-400 border-teal-500/30 bg-teal-500/10', content: <p>{r.trend_analysis}</p> });
    }
    if (r.recommendations.length > 0) {
      s.push({
        id: 'recommendations',
        label: 'Recommendations',
        icon: <Lightbulb className="w-3.5 h-3.5" />,
        color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
        content: (
          <ol className="list-decimal list-inside space-y-2">
            {r.recommendations.map((rec, i) => <li key={i}>{rec}</li>)}
          </ol>
        ),
      });
    }
    return s;
  }, [data.report]);

  const scrollToSection = useCallback((id: string) => {
    const el = sectionRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setActiveSection(id);
      setTimeout(() => setActiveSection(null), 2000);
    }
  }, []);

  return (
    <div className="relative overflow-hidden rounded-xl border border-border-subtle bg-surface-elevated transition-all hover:border-primary-500/30">
      <div className="absolute inset-0 bg-noise opacity-20 pointer-events-none" />

      {/* ── Header (always visible) ── */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="relative z-10 w-full text-left p-5 flex items-start gap-4"
      >
        {/* Severity dot */}
        <div className="flex-shrink-0 mt-1">
          <div className={`w-3 h-3 rounded-full ${sev.dot}`} />
        </div>

        {/* Title + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full ${sev.badge}`}>
              {data.severity}
            </span>
            <h3 className="text-sm font-semibold text-content-primary truncate">{data.title}</h3>
          </div>
          <p className="text-xs text-content-muted line-clamp-2 mb-2">{data.report.summary}</p>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-content-faint">
            {data.assigned_to && (
              <span className="inline-flex items-center gap-1">
                <User className="w-3 h-3" /> Assigned: <span className="text-content-muted font-medium">{data.assigned_to}</span>
              </span>
            )}
            {data.resolved_by && (
              <span className="inline-flex items-center gap-1">
                <UserCheck className="w-3 h-3" /> Resolved by: <span className="text-content-muted font-medium">{data.resolved_by}</span>
              </span>
            )}
            {data.resolution_category && (
              <span className="inline-flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {CATEGORY_LABELS[data.resolution_category] ?? data.resolution_category}
              </span>
            )}
            {data.resolved_at && (
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" /> {timeAgo(data.resolved_at)}
                {data.created_at && <span className="text-content-faint">· TTR {ttr(data.created_at, data.resolved_at)}</span>}
              </span>
            )}
          </div>
        </div>

        {/* Expand chevron */}
        <div className="flex-shrink-0 mt-1 text-content-faint">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* ── Expanded content ── */}
      {expanded && (
        <div className="relative z-10 px-5 pb-5 border-t border-border-subtle">
          {/* Resolution note */}
          {data.resolution_note && (
            <div className="mt-4 mb-5 p-3 rounded-lg border border-success/20 bg-success/5">
              <p className="text-xs font-medium text-success mb-1">Resolution Note</p>
              <p className="text-sm text-content-secondary">{data.resolution_note}</p>
            </div>
          )}

          {/* TOC */}
          <div className="flex flex-wrap gap-2 mb-5 pb-4 border-b border-border-subtle">
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

          {/* Report sections */}
          <div className="space-y-4 text-sm text-content-secondary leading-relaxed">
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
                <h4 className={`flex items-center gap-2 text-sm font-semibold mb-2 ${sec.color.split(' ')[0]}`}>
                  {sec.icon}
                  {sec.label}
                </h4>
                <div className={activeSection === sec.id ? 'text-content-primary' : ''}>
                  {sec.content}
                </div>
              </div>
            ))}
          </div>

          {/* Severity justification */}
          {data.report.severity_justification && (
            <div className="mt-4 p-3 rounded-lg border border-border-subtle bg-surface-inset">
              <p className="text-xs font-medium text-content-faint mb-1">Severity Justification</p>
              <p className="text-sm text-content-secondary">{data.report.severity_justification}</p>
            </div>
          )}

          <p className="text-xs text-content-faint mt-4 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" />
            Report generated {new Date(data.report.generated_at).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Reports Page ── */
export function ReportsPage({ incidents }: { incidents: IncidentSummary[] }) {
  const [liveReports, setLiveReports] = useState<ResolvedReport[]>([]);
  const [loadingLive, setLoadingLive] = useState(false);
  const fetchedRef = useRef(false);

  // Seed reports from historical data
  const seedReports = useMemo<ResolvedReport[]>(() => {
    return Object.entries(SEED_REPORTS).map(([id, entry]) => {
      const seedInc = incidents.find((i) => i.id === id);
      return {
        id,
        title: seedInc?.title ?? `Incident ${id}`,
        severity: entry.severity,
        assigned_to: entry.assigned_to,
        resolved_by: entry.resolved_by,
        resolution_note: entry.resolution_note,
        resolution_category: entry.resolution_category,
        resolved_at: entry.resolved_at,
        created_at: seedInc?.created_at ?? entry.resolved_at,
        report: entry.report,
      };
    });
  }, [incidents]);

  // Fetch full details for live resolved incidents that have reports
  useEffect(() => {
    const resolved = incidents.filter(
      (i) => i.status === 'resolved' && i.has_report && !i.id.startsWith('hist-')
    );
    if (resolved.length === 0 || fetchedRef.current) return;
    fetchedRef.current = true;

    setLoadingLive(true);
    Promise.all(resolved.map((i) => api.getIncident(i.id).catch(() => null)))
      .then((details) => {
        const reports: ResolvedReport[] = [];
        for (const d of details) {
          if (!d || !d.report) continue;
          reports.push({
            id: d.id,
            title: d.title,
            severity: d.severity,
            assigned_to: d.assigned_to,
            resolved_by: d.resolved_by,
            resolution_note: d.resolution_note,
            resolution_category: d.resolution_category,
            resolved_at: d.resolved_at,
            created_at: d.created_at,
            report: d.report,
          });
        }
        setLiveReports(reports);
      })
      .finally(() => setLoadingLive(false));
  }, [incidents]);

  // Merge and sort by resolved_at (newest first)
  const allReports = useMemo(() => {
    const merged = [...liveReports, ...seedReports];
    return merged.sort((a, b) => {
      const da = a.resolved_at ? new Date(a.resolved_at).getTime() : 0;
      const db = b.resolved_at ? new Date(b.resolved_at).getTime() : 0;
      return db - da;
    });
  }, [liveReports, seedReports]);

  if (allReports.length === 0 && !loadingLive) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8">
        <div className="w-16 h-16 mb-4 rounded-2xl bg-primary-500/10 border border-border-subtle flex items-center justify-center">
          <FileText className="w-8 h-8 text-primary-400" />
        </div>
        <h2 className="text-lg font-bold text-content-primary mb-2">No Reports Yet</h2>
        <p className="text-sm text-content-muted max-w-sm">
          AI incident reports will appear here once incidents are resolved. Run the pipeline and resolve an incident to generate your first report.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-xl font-bold text-content-primary flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary-400" />
            AI Incident Reports
          </h1>
          <p className="text-sm text-content-muted mt-1">
            Post-mortem reports for resolved incidents · {allReports.length} report{allReports.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {loadingLive && (
        <div className="text-sm text-content-muted flex items-center gap-2 py-2">
          <div className="w-4 h-4 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
          Loading live incident reports…
        </div>
      )}

      {/* Report cards */}
      <div className="space-y-3">
        {allReports.map((r) => (
          <ReportCard key={r.id} data={r} />
        ))}
      </div>
    </div>
  );
}

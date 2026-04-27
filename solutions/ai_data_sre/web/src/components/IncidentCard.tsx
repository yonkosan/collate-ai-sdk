import {
  AlertTriangle,
  ChevronRight,
  Clock,
  Database,
  Loader2,
  RefreshCw,
  Sparkles,
  User,
} from 'lucide-react';
import type { IncidentSummary } from '../types';
import {
  SEVERITY_CONFIG,
  DEFAULT_SEVERITY_CONFIG,
  STATUS_CONFIG,
} from '../data/constants';
import { SlackIcon } from './BrandIcons';

interface IncidentCardProps {
  incident: IncidentSummary;
  onClick: () => void;
}

export function IncidentCard({ incident, onClick }: IncidentCardProps) {
  const sev = SEVERITY_CONFIG[incident.severity] ?? DEFAULT_SEVERITY_CONFIG;
  const status = STATUS_CONFIG[incident.status] ?? { color: 'text-content-muted', label: incident.status };
  const shortTable = incident.root_cause_table.split('.').pop() ?? incident.root_cause_table;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl border ${sev.border} bg-surface-elevated p-5 transition-all hover:border-primary-400/40 hover:shadow-card-hover group animate-fade-in`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          {/* Top badges row */}
          <div className="flex items-center gap-2.5 mb-2.5">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${sev.dot}`} />
            <span className={`inline-flex px-2.5 py-0.5 text-xs font-bold rounded-full ${sev.badge}`}>
              {incident.severity}
            </span>
            <span className={`text-xs font-medium ${status.color} uppercase tracking-wider`}>
              {status.label}
            </span>
            {incident.has_recurring_failures && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-warning bg-warning/10 border border-warning/20 rounded-full">
                <RefreshCw className="w-3 h-3" />
                Recurring
              </span>
            )}
            {incident.report_generating && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-primary-400 bg-primary-500/10 border border-primary-500/20 rounded-full">
                <Loader2 className="w-3 h-3 animate-spin" />
                AI Report
              </span>
            )}
            {incident.has_report && !incident.report_generating && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                <Sparkles className="w-3 h-3" />
                Report
              </span>
            )}
          </div>

          {/* Title */}
          <h3 className="text-sm font-semibold text-content-primary mb-3 group-hover:text-primary-400 transition-colors">
            {incident.title}
          </h3>

          {/* Metadata row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-content-muted">
            <span className="flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              {incident.failure_count} failure{incident.failure_count !== 1 ? 's' : ''}
            </span>
            <span className="flex items-center gap-1">
              <Database className="w-3.5 h-3.5" />
              {incident.blast_radius_size} asset{incident.blast_radius_size !== 1 ? 's' : ''}
            </span>
            <span className="flex items-center gap-1 text-primary-400">
              <Database className="w-3.5 h-3.5" />
              {shortTable}
            </span>
            {incident.assigned_to && (
              <span className="flex items-center gap-1 text-secondary-400">
                <User className="w-3.5 h-3.5" />
                {incident.assigned_to}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {new Date(incident.created_at).toLocaleTimeString()}
            </span>
            {incident.slack_thread_url && (
              <a
                href={incident.slack_thread_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 text-primary-400 hover:text-primary-300 transition-colors"
                title="View Slack thread"
              >
                <SlackIcon className="w-3.5 h-3.5" />
                Slack
              </a>
            )}
          </div>
        </div>

        <ChevronRight className="w-5 h-5 text-content-faint group-hover:text-primary-400 transition-colors mt-1 flex-shrink-0" />
      </div>
    </button>
  );
}

import {
  AlertTriangle,
  ChevronRight,
  Clock,
  Database,
  RefreshCw,
  User,
} from 'lucide-react';
import type { IncidentSummary } from '../types';

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string; badge: string }> = {
  CRITICAL: {
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    border: 'border-red-500/30',
    badge: 'bg-red-500 text-white badge-critical',
  },
  HIGH: {
    bg: 'bg-orange-500/10',
    text: 'text-orange-400',
    border: 'border-orange-500/30',
    badge: 'bg-orange-500 text-white',
  },
  MEDIUM: {
    bg: 'bg-yellow-500/10',
    text: 'text-yellow-400',
    border: 'border-yellow-500/30',
    badge: 'bg-yellow-500 text-black',
  },
  LOW: {
    bg: 'bg-green-500/10',
    text: 'text-green-400',
    border: 'border-green-500/30',
    badge: 'bg-green-500 text-white',
  },
  INFO: {
    bg: 'bg-gray-500/10',
    text: 'text-gray-400',
    border: 'border-gray-500/30',
    badge: 'bg-gray-500 text-white',
  },
};

const DEFAULT_STYLE = {
  bg: 'bg-gray-500/10',
  text: 'text-gray-400',
  border: 'border-gray-500/30',
  badge: 'bg-gray-500 text-white',
};

const STATUS_COLORS: Record<string, string> = {
  detected: 'text-red-400',
  investigating: 'text-yellow-400',
  reported: 'text-blue-400',
  acknowledged: 'text-purple-400',
  resolved: 'text-green-400',
};

interface IncidentCardProps {
  incident: IncidentSummary;
  onClick: () => void;
}

export function IncidentCard({ incident, onClick }: IncidentCardProps) {
  const style = SEVERITY_STYLES[incident.severity] ?? DEFAULT_STYLE;
  const statusColor = STATUS_COLORS[incident.status] ?? 'text-gray-400';
  const shortTable = incident.root_cause_table.split('.').pop() ?? incident.root_cause_table;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left ${style.bg} border ${style.border} rounded-lg p-5 hover:bg-opacity-20 transition-all group`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <span
              className={`inline-flex px-2.5 py-0.5 text-xs font-bold rounded-full ${style.badge}`}
            >
              {incident.severity}
            </span>
            <span className={`text-xs font-medium ${statusColor} uppercase tracking-wider`}>
              {incident.status}
            </span>
            {incident.has_recurring_failures && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-full">
                <RefreshCw className="w-3 h-3" />
                Recurring
              </span>
            )}
          </div>

          <h3 className="text-base font-semibold text-white mb-3 group-hover:text-blue-300 transition-colors">
            {incident.title}
          </h3>

          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              {incident.failure_count} failure{incident.failure_count !== 1 ? 's' : ''}
            </span>
            <span className="flex items-center gap-1">
              <Database className="w-3.5 h-3.5" />
              {incident.blast_radius_size} asset{incident.blast_radius_size !== 1 ? 's' : ''} affected
            </span>
            <span className="flex items-center gap-1">
              <Database className="w-3.5 h-3.5 text-blue-400" />
              {shortTable}
            </span>
            {incident.assigned_to && (
              <span className="flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-purple-400" />
                {incident.assigned_to}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {new Date(incident.created_at).toLocaleTimeString()}
            </span>
          </div>
        </div>

        <ChevronRight className="w-5 h-5 text-gray-500 group-hover:text-blue-400 transition-colors mt-1" />
      </div>
    </button>
  );
}

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Filter,
  Search,
} from 'lucide-react';
import type { IncidentSummary } from '../types';
import { SEVERITY_CONFIG, DEFAULT_SEVERITY_CONFIG, STATUS_CONFIG } from '../data/constants';

type FilterStatus = 'all' | 'active' | 'resolved';

interface IncidentsPageProps {
  currentIncidents: IncidentSummary[];
  pastIncidents: IncidentSummary[];
  onOpen: (id: string) => void;
}

export function IncidentsPage({ currentIncidents, pastIncidents, onOpen }: IncidentsPageProps) {
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [search, setSearch] = useState('');

  const all = [...currentIncidents, ...pastIncidents];
  const filtered = all.filter((inc) => {
    if (filter === 'active' && inc.status === 'resolved') return false;
    if (filter === 'resolved' && inc.status !== 'resolved') return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        inc.title.toLowerCase().includes(q) ||
        inc.root_cause_table.toLowerCase().includes(q) ||
        inc.severity.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const activeCount = all.filter((i) => i.status !== 'resolved').length;
  const resolvedCount = all.filter((i) => i.status === 'resolved').length;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 mb-4">
        <h2 className="text-xl font-bold text-content-primary tracking-tight mb-4">
          All Incidents
        </h2>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-surface-elevated border border-border-subtle rounded-xl p-1">
            {(['all', 'active', 'resolved'] as FilterStatus[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all capitalize ${
                  filter === f
                    ? 'bg-primary-500/15 text-primary-400'
                    : 'text-content-muted hover:text-content-primary'
                }`}
              >
                {f}
                <span className="ml-1.5 text-content-faint">
                  {f === 'all' ? all.length : f === 'active' ? activeCount : resolvedCount}
                </span>
              </button>
            ))}
          </div>

          <div className="flex-1 max-w-xs">
            <div className="flex items-center gap-2 bg-surface-elevated border border-border-subtle rounded-xl px-3 py-2">
              <Search className="w-3.5 h-3.5 text-content-faint" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search incidents…"
                className="bg-transparent text-sm text-content-primary placeholder-content-faint focus:outline-none w-full"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-content-muted">
            <Filter className="w-3.5 h-3.5" />
            {filtered.length} incident{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Incident list — scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-1">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-content-muted">
            <AlertTriangle className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">No incidents match your filters.</p>
          </div>
        ) : (
          filtered.map((inc) => {
            const sev = SEVERITY_CONFIG[inc.severity] ?? DEFAULT_SEVERITY_CONFIG;
            const status = STATUS_CONFIG[inc.status] ?? { color: 'text-content-muted', label: inc.status };
            const shortTable = inc.root_cause_table.split('.').pop() ?? inc.root_cause_table;
            const isPast = inc.id.startsWith('hist-');

            const isResolved = inc.status === 'resolved';

            return (
              <button
                key={inc.id}
                onClick={() => !isPast && onOpen(inc.id)}
                disabled={isPast}
                className={`w-full text-left rounded-xl border-l-[3px] border p-4 transition-all group ${
                  isResolved
                    ? 'border-l-emerald-500 border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10'
                    : 'border-l-red-500 border-red-500/20 bg-red-500/5 hover:bg-red-500/10'
                } ${
                  isPast
                    ? 'opacity-75 cursor-default'
                    : 'hover:shadow-card-hover cursor-pointer'
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Severity dot */}
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${sev.dot}`} />

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-xs font-bold ${sev.text}`}>{inc.severity}</span>
                      <span className={`text-xs font-medium ${status.color} uppercase tracking-wider`}>
                        {status.label}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-content-primary truncate">
                      {inc.title}
                    </p>
                  </div>

                  {/* Meta */}
                  <div className="flex items-center gap-4 text-xs text-content-muted flex-shrink-0">
                    <span className="flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {inc.failure_count}
                    </span>
                    <span className="hidden sm:flex items-center gap-1">
                      {shortTable}
                    </span>
                    {inc.assigned_to && (
                      <span className="hidden md:flex items-center gap-1 text-secondary-400">
                        {inc.assigned_to}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      {inc.status === 'resolved' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                      ) : (
                        <Clock className="w-3.5 h-3.5" />
                      )}
                      {new Date(inc.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

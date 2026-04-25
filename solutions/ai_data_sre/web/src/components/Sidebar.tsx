import {
  Activity,
  AlertTriangle,
  FileText,
  GitBranch,
  LayoutDashboard,
  Menu,
  Settings,
  X,
} from 'lucide-react';
import type { IncidentSummary } from '../types';
import { SEVERITY_CONFIG, DEFAULT_SEVERITY_CONFIG } from '../data/constants';

const NAV_ICONS: Record<string, React.ReactNode> = {
  dashboard: <LayoutDashboard className="w-4 h-4" />,
  incidents: <AlertTriangle className="w-4 h-4" />,
  lineage: <GitBranch className="w-4 h-4" />,
  reports: <FileText className="w-4 h-4" />,
  settings: <Settings className="w-4 h-4" />,
};

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'lineage', label: 'Lineage' },
  { id: 'reports', label: 'Reports' },
];

interface SidebarProps {
  incidents: IncidentSummary[];
  activeNav: string;
  onNavChange: (id: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export function Sidebar({ incidents, activeNav, onNavChange, isOpen, onToggle }: SidebarProps) {
  const activeCount = incidents.filter(
    (i) => i.status !== 'resolved'
  ).length;

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={onToggle}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-surface-elevated border border-border-subtle text-content-primary"
        aria-label="Toggle sidebar"
      >
        {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-30"
          onClick={onToggle}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={`fixed top-0 left-0 z-40 h-full w-64 bg-surface-base border-r border-border-subtle flex flex-col transition-transform duration-300 lg:translate-x-0 lg:static lg:z-auto ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand */}
        <div className="p-5 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-primary flex items-center justify-center shadow-glow">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-content-primary tracking-tight">DataPulse</h1>
              <p className="text-xs text-content-muted">AI Incident Center</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <p className="px-3 mb-2 text-xs font-semibold text-content-faint uppercase tracking-wider">
            Navigation
          </p>
          {NAV_ITEMS.map((item) => {
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onNavChange(item.id);
                  onToggle();
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-primary-500/15 text-primary-400 shadow-glow'
                    : 'text-content-secondary hover:text-content-primary hover:bg-surface-soft'
                }`}
              >
                <span className={isActive ? 'text-primary-400' : 'text-content-muted'}>
                  {NAV_ICONS[item.id]}
                </span>
                {item.label}
                {item.id === 'incidents' && activeCount > 0 && (
                  <span className="ml-auto text-xs font-bold bg-danger/20 text-danger px-1.5 py-0.5 rounded-full">
                    {activeCount}
                  </span>
                )}
              </button>
            );
          })}

          {/* Incident mini-list */}
          {incidents.length > 0 && (
            <div className="mt-6">
              <p className="px-3 mb-2 text-xs font-semibold text-content-faint uppercase tracking-wider">
                Recent Incidents
              </p>
              <div className="space-y-1">
                {incidents.slice(0, 5).map((inc) => {
                  const sev = SEVERITY_CONFIG[inc.severity] ?? DEFAULT_SEVERITY_CONFIG;
                  const shortTable = inc.root_cause_table.split('.').pop() ?? inc.root_cause_table;
                  return (
                    <button
                      key={inc.id}
                      onClick={() => {
                        onNavChange('incidents');
                        onToggle();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-surface-soft transition-colors"
                    >
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${sev.dot}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-content-primary truncate">
                          {shortTable}
                        </p>
                        <p className="text-xs text-content-muted truncate">
                          {inc.failure_count} failure{inc.failure_count !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </nav>

        {/* Bottom area */}
        <div className="p-4 border-t border-border-subtle">
          <button
            onClick={() => onNavChange('settings')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-content-muted hover:text-content-primary hover:bg-surface-soft transition-colors"
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>
        </div>
      </aside>
    </>
  );
}

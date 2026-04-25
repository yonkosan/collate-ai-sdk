import { useCallback, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Shield,
  UserCheck,
} from 'lucide-react';
import { api } from './api';
import type { IncidentDetail, IncidentSummary } from './types';
import { sortBySeverity } from './data/constants';
import { useTheme } from './hooks/useTheme';
import { Sidebar } from './components/Sidebar';
import { HeaderBar } from './components/HeaderBar';
import { StatCard } from './components/StatCard';
import { PromoCard } from './components/PromoCard';
import { IncidentSection } from './components/IncidentSection';
import { IncidentDetailPanel } from './components/IncidentDetailPanel';
import { EmptyState } from './components/EmptyState';

type View = 'dashboard' | 'detail';

export default function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [view, setView] = useState<View>('dashboard');
  const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<IncidentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [pipelineRan, setPipelineRan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const runPipeline = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.runPipeline();
      setIncidents(sortBySeverity(res.incidents));
      setPipelineRan(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pipeline failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshIncidents = useCallback(async () => {
    try {
      const list = await api.listIncidents();
      setIncidents(sortBySeverity(list));
    } catch {
      /* ignore */
    }
  }, []);

  const openIncident = useCallback(async (id: string) => {
    try {
      const detail = await api.getIncident(id);
      setSelectedIncident(detail);
      setView('detail');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load incident');
    }
  }, []);

  const goBack = useCallback(() => {
    setView('dashboard');
    setSelectedIncident(null);
    refreshIncidents();
  }, [refreshIncidents]);

  /* ─── Derived state ─────────────────────────────── */
  const criticalCount = incidents.filter(
    (i) => i.severity === 'CRITICAL' || i.severity === 'HIGH'
  ).length;

  const activeIncidents = incidents.filter(
    (i) => i.status === 'detected' || i.status === 'investigating' || i.status === 'reported'
  );
  const assignedIncidents = incidents.filter(
    (i) => i.status === 'acknowledged' || (i.assigned_to && i.status !== 'resolved')
  );
  const resolvedIncidents = incidents.filter(
    (i) => i.status === 'resolved'
  );

  const recurringCount = incidents.filter((i) => i.has_recurring_failures).length;

  return (
    <div className="min-h-screen bg-surface-page flex">
      {/* Sidebar */}
      <Sidebar
        incidents={incidents}
        activeNav="dashboard"
        onNavChange={() => {}}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <HeaderBar
          theme={theme}
          onToggleTheme={toggleTheme}
          loading={loading}
          pipelineRan={pipelineRan}
          onRunPipeline={runPipeline}
          onRefresh={refreshIncidents}
        />

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 2xl:px-12">
          <div className="max-w-7xl mx-auto">
            {/* Error banner */}
            {error && (
              <div className="mb-6 p-4 bg-danger/10 border border-danger/30 rounded-xl flex items-center gap-3 animate-fade-in">
                <AlertTriangle className="w-5 h-5 text-danger flex-shrink-0" />
                <p className="text-danger text-sm">{error}</p>
              </div>
            )}

            {view === 'dashboard' && (
              <div className="animate-fade-in">
                {/* Hero row */}
                <div className="mb-8">
                  <p className="text-xs font-semibold text-content-muted uppercase tracking-widest mb-1">
                    Overview
                  </p>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <h2 className="text-2xl font-bold text-content-primary tracking-tight">
                        Incident Dashboard
                      </h2>
                      {pipelineRan && incidents.length > 0 && (
                        <span className="text-xs font-semibold bg-primary-500/15 text-primary-400 px-2.5 py-1 rounded-full border border-primary-500/30">
                          {incidents.length} total
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Stats + Promo grid */}
                {pipelineRan && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                    <StatCard
                      label="Total Incidents"
                      value={incidents.length}
                      icon={<AlertTriangle className="w-4 h-4" />}
                      sparkData={[3, 5, 2, 8, 4, 6, incidents.length]}
                      sparkColor="#8b5cf6"
                      accentColor="text-primary-400"
                    />
                    <StatCard
                      label="Critical / High"
                      value={criticalCount}
                      icon={<Shield className="w-4 h-4" />}
                      delta={criticalCount > 0 ? { value: -criticalCount * 10, label: 'vs last scan' } : undefined}
                      sparkData={[1, 3, 2, 5, 4, 2, criticalCount]}
                      sparkColor="#fb7185"
                      accentColor="text-danger"
                    />
                    <StatCard
                      label="Recurring"
                      value={recurringCount}
                      icon={<RefreshCw className="w-4 h-4" />}
                      sparkData={[2, 1, 3, 2, 4, 3, recurringCount]}
                      sparkColor="#fbbf24"
                      accentColor="text-warning"
                    />
                    <PromoCard onRunPipeline={runPipeline} loading={loading} />
                  </div>
                )}

                {/* Incident blocks */}
                {!pipelineRan ? (
                  <EmptyState onRun={runPipeline} loading={loading} />
                ) : incidents.length === 0 ? (
                  <div className="text-center py-20">
                    <Shield className="w-16 h-16 mx-auto mb-4 text-success" />
                    <h2 className="text-xl font-semibold text-success mb-2">All Clear!</h2>
                    <p className="text-content-muted">No data quality incidents detected.</p>
                  </div>
                ) : (
                  <div className="space-y-10">
                    {activeIncidents.length > 0 && (
                      <IncidentSection
                        title="Active Incidents"
                        icon={<AlertTriangle className="w-5 h-5 text-danger" />}
                        count={activeIncidents.length}
                        accentColor="border-danger/40"
                        incidents={activeIncidents}
                        onOpen={openIncident}
                      />
                    )}

                    {assignedIncidents.length > 0 && (
                      <IncidentSection
                        title="Assigned / In Progress"
                        icon={<UserCheck className="w-5 h-5 text-warning" />}
                        count={assignedIncidents.length}
                        accentColor="border-warning/40"
                        incidents={assignedIncidents}
                        onOpen={openIncident}
                      />
                    )}

                    {resolvedIncidents.length > 0 && (
                      <IncidentSection
                        title="Resolved"
                        icon={<CheckCircle2 className="w-5 h-5 text-success" />}
                        count={resolvedIncidents.length}
                        accentColor="border-success/40"
                        incidents={resolvedIncidents}
                        onOpen={openIncident}
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            {view === 'detail' && selectedIncident && (
              <IncidentDetailPanel
                incident={selectedIncident}
                onBack={goBack}
                onUpdate={(updated) => setSelectedIncident(updated)}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

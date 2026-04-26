import { useCallback, useRef, useState } from 'react';
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
import { PAST_INCIDENTS } from './data/seedIncidents';
import { useTheme } from './hooks/useTheme';
import { Sidebar } from './components/Sidebar';
import { HeaderBar } from './components/HeaderBar';
import { StatCard } from './components/StatCard';
import { PromoCard } from './components/PromoCard';
import { IncidentSection } from './components/IncidentSection';
import { IncidentDetailPanel } from './components/IncidentDetailPanel';
import { EmptyState } from './components/EmptyState';
import { IncidentsPage } from './components/IncidentsPage';
import { ReportsPage, SettingsPage } from './components/PlaceholderPages';
import { UnifiedLineagePage } from './components/UnifiedLineagePage';

type NavPage = 'dashboard' | 'incidents' | 'lineage' | 'reports' | 'settings';
type View = { page: NavPage } | { page: 'detail'; incidentId: string };

export default function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [view, setView] = useState<View>({ page: 'dashboard' });
  const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<IncidentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [pipelinePhase, setPipelinePhase] = useState<string | null>(null);
  const [pipelineRan, setPipelineRan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const runPipelineSSE = useCallback(() => {
    setLoading(true);
    setError(null);
    setIncidents([]);
    setPipelinePhase('Scanning for failures…');

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource('/api/pipeline/stream');
    eventSourceRef.current = es;

    es.addEventListener('phase', (e) => {
      setPipelinePhase((e as MessageEvent).data);
    });

    es.addEventListener('incident', (e) => {
      try {
        const inc: IncidentSummary = JSON.parse((e as MessageEvent).data);
        setIncidents((prev) => sortBySeverity([...prev, inc]));
      } catch { /* ignore */ }
    });

    es.addEventListener('update', (e) => {
      try {
        const inc: IncidentSummary = JSON.parse((e as MessageEvent).data);
        setIncidents((prev) =>
          sortBySeverity(prev.map((p) => (p.id === inc.id ? inc : p)))
        );
      } catch { /* ignore */ }
    });

    es.addEventListener('done', () => {
      es.close();
      eventSourceRef.current = null;
      setLoading(false);
      setPipelinePhase(null);
      setPipelineRan(true);
    });

    es.addEventListener('error', () => {
      es.close();
      eventSourceRef.current = null;
      setPipelinePhase(null);
      // Fallback: try the regular non-streaming endpoint
      runPipelineFallback();
    });
  }, []);

  const runPipelineFallback = useCallback(async () => {
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
      setView({ page: 'detail', incidentId: id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load incident');
    }
  }, []);

  const goBack = useCallback(() => {
    setView({ page: 'dashboard' });
    setSelectedIncident(null);
    refreshIncidents();
  }, [refreshIncidents]);

  const navigateTo = useCallback((page: string) => {
    setSelectedIncident(null);
    setView({ page: page as NavPage });
  }, []);

  /* ─── Derived state ─────────────────────────────── */
  const allIncidents = [...incidents, ...PAST_INCIDENTS];

  const criticalCount = allIncidents.filter(
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

  const recurringCount = allIncidents.filter((i) => i.has_recurring_failures).length;
  const pastCritical = PAST_INCIDENTS.filter(
    (i) => i.severity === 'CRITICAL' || i.severity === 'HIGH'
  ).length;
  const currentCritical = incidents.filter(
    (i) => i.severity === 'CRITICAL' || i.severity === 'HIGH'
  ).length;

  // Sorted for mini-lists: active first (newest), then resolved (newest)
  const allSorted = [...allIncidents].sort((a, b) => {
    const aResolved = a.status === 'resolved' ? 1 : 0;
    const bResolved = b.status === 'resolved' ? 1 : 0;
    if (aResolved !== bResolved) return aResolved - bResolved;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  const critHighSorted = allSorted.filter(
    (i) => i.severity === 'CRITICAL' || i.severity === 'HIGH'
  );
  const recurringSorted = allSorted.filter((i) => i.has_recurring_failures);

  const currentPage = view.page;

  return (
    <div className="h-screen bg-surface-page flex overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        incidents={incidents}
        activeNav={currentPage === 'detail' ? 'dashboard' : currentPage}
        onNavChange={navigateTo}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />

      {/* Main area — flex column, no page scroll */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Header — fixed height */}
        <HeaderBar
          theme={theme}
          onToggleTheme={toggleTheme}
          loading={loading}
          pipelineRan={pipelineRan}
          onRunPipeline={runPipelineSSE}
          onRefresh={refreshIncidents}
          pipelinePhase={pipelinePhase}
        />

        {/* Content — fills remaining height, scrolls internally */}
        <main className="flex-1 overflow-hidden px-4 py-4 sm:px-6 lg:px-8 2xl:px-12">
          <div className="h-full max-w-7xl mx-auto flex flex-col">
            {/* Error banner */}
            {error && (
              <div className="flex-shrink-0 mb-4 p-3 bg-danger/10 border border-danger/30 rounded-xl flex items-center gap-3 animate-fade-in">
                <AlertTriangle className="w-5 h-5 text-danger flex-shrink-0" />
                <p className="text-danger text-sm">{error}</p>
              </div>
            )}

            {/* === DASHBOARD === */}
            {currentPage === 'dashboard' && (
              <div className="flex-1 flex flex-col min-h-0 animate-fade-in">
                {/* Stats row — fixed height */}
                {pipelineRan && (
                  <div className="flex-shrink-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                    <StatCard
                      label="Total Incidents"
                      value={allIncidents.length}
                      icon={<AlertTriangle className="w-4 h-4" />}
                      subtitle={`${incidents.length} active · ${PAST_INCIDENTS.length} resolved`}
                      items={allSorted}
                      sparkData={[2, 1, 4, 1, 3, PAST_INCIDENTS.length, allIncidents.length]}
                      sparkColor="#8b5cf6"
                      accentColor="text-primary-400"
                    />
                    <StatCard
                      label="Critical / High"
                      value={criticalCount}
                      icon={<Shield className="w-4 h-4" />}
                      subtitle={`${currentCritical} active · ${pastCritical} resolved`}
                      items={critHighSorted}
                      sparkData={[1, 2, 1, 3, pastCritical, criticalCount]}
                      sparkColor="#fb7185"
                      accentColor="text-danger"
                    />
                    <StatCard
                      label="Recurring"
                      value={recurringCount}
                      icon={<RefreshCw className="w-4 h-4" />}
                      subtitle={recurringCount > 0 ? `${recurringCount} test${recurringCount !== 1 ? 's' : ''} failed 2+ times` : 'No repeat failures'}
                      items={recurringSorted}
                      showRecurring
                      sparkData={[0, 1, 0, 2, 1, recurringCount]}
                      sparkColor="#fbbf24"
                      accentColor="text-warning"
                    />
                    <PromoCard onRunPipeline={runPipelineSSE} loading={loading} />
                  </div>
                )}

                {/* Pipeline phase indicator */}
                {loading && pipelinePhase && (
                  <div className="flex-shrink-0 mb-4 px-4 py-2.5 bg-primary-500/10 border border-primary-500/20 rounded-xl flex items-center gap-3 animate-fade-in">
                    <RefreshCw className="w-4 h-4 text-primary-400 animate-spin" />
                    <span className="text-sm text-primary-400 font-medium">{pipelinePhase}</span>
                  </div>
                )}

                {/* Incident sections — scrollable */}
                <div className="flex-1 overflow-y-auto min-h-0 pr-1">
                  {!pipelineRan ? (
                    <EmptyState onRun={runPipelineSSE} loading={loading} />
                  ) : incidents.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full">
                      <Shield className="w-16 h-16 mb-4 text-success" />
                      <h2 className="text-xl font-semibold text-success mb-2">All Clear!</h2>
                      <p className="text-content-muted">No data quality incidents detected.</p>
                    </div>
                  ) : (
                    <div className="space-y-8">
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
              </div>
            )}

            {/* === INCIDENTS PAGE === */}
            {currentPage === 'incidents' && (
              <div className="flex-1 min-h-0">
                <IncidentsPage
                  currentIncidents={incidents}
                  pastIncidents={PAST_INCIDENTS}
                  onOpen={openIncident}
                />
              </div>
            )}

            {/* === DETAIL === */}
            {currentPage === 'detail' && selectedIncident && (
              <div className="flex-1 overflow-y-auto min-h-0">
                <IncidentDetailPanel
                  incident={selectedIncident}
                  onBack={goBack}
                  onUpdate={(updated) => setSelectedIncident(updated)}
                />
              </div>
            )}

            {/* === LINEAGE === */}
            {currentPage === 'lineage' && (
              <div className="flex-1 min-h-0">
                <UnifiedLineagePage incidents={incidents} />
              </div>
            )}

            {/* === PLACEHOLDER PAGES === */}
            {currentPage === 'reports' && (
              <div className="flex-1 min-h-0"><ReportsPage /></div>
            )}
            {currentPage === 'settings' && (
              <div className="flex-1 min-h-0"><SettingsPage /></div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

import { useCallback, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Play,
  RefreshCw,
  Shield,
  UserCheck,
} from 'lucide-react';
import { api } from './api';
import type { IncidentDetail, IncidentSummary } from './types';
import { IncidentCard } from './components/IncidentCard';
import { IncidentDetailPanel } from './components/IncidentDetailPanel';

type View = 'dashboard' | 'detail';

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

export default function App() {
  const [view, setView] = useState<View>('dashboard');
  const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<IncidentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [pipelineRan, setPipelineRan] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runPipeline = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.runPipeline();
      setIncidents(
        [...res.incidents].sort(
          (a, b) =>
            (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
        )
      );
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
      setIncidents(
        [...list].sort(
          (a, b) =>
            (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
        )
      );
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

  const criticalCount = incidents.filter(
    (i) => i.severity === 'CRITICAL' || i.severity === 'HIGH'
  ).length;

  const activeIncidents = incidents.filter(
    (i) => i.status === 'detected' || i.status === 'investigating' || i.status === 'reported'
  );
  const assignedIncidents = incidents.filter(
    (i) => i.status === 'acknowledged' || i.assigned_to
  );
  const resolvedIncidents = incidents.filter(
    (i) => i.status === 'resolved'
  );

  return (
    <div className="min-h-screen bg-pulse-bg">
      {/* Header */}
      <header className="border-b border-pulse-border bg-pulse-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">DataPulse</h1>
              <p className="text-xs text-gray-400">
                AI-Powered Data Incident Command Center
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {pipelineRan && (
              <button
                onClick={refreshIncidents}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:text-white border border-pulse-border rounded-lg hover:bg-pulse-card transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
            )}
            <button
              onClick={runPipeline}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-pulse-accent hover:bg-blue-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Running Pipeline…
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Run Pipeline
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {view === 'dashboard' && (
          <>
            {/* Stats bar */}
            {pipelineRan && (
              <div className="grid grid-cols-4 gap-4 mb-8">
                <StatCard
                  label="Total Incidents"
                  value={incidents.length}
                  icon={<AlertTriangle className="w-5 h-5" />}
                  color="text-blue-400"
                />
                <StatCard
                  label="Critical / High"
                  value={criticalCount}
                  icon={<Shield className="w-5 h-5" />}
                  color="text-red-400"
                />
                <StatCard
                  label="Recurring"
                  value={incidents.filter((i) => i.has_recurring_failures).length}
                  icon={<RefreshCw className="w-5 h-5" />}
                  color="text-yellow-400"
                />
                <StatCard
                  label="Resolved"
                  value={
                    incidents.filter((i) => i.status === 'resolved').length
                  }
                  icon={<Activity className="w-5 h-5" />}
                  color="text-green-400"
                />
              </div>
            )}

            {/* Incident list */}
            {!pipelineRan ? (
              <EmptyState onRun={runPipeline} loading={loading} />
            ) : incidents.length === 0 ? (
              <div className="text-center py-20 text-gray-400">
                <Shield className="w-16 h-16 mx-auto mb-4 text-green-400" />
                <h2 className="text-xl font-semibold text-green-400 mb-2">
                  All Clear!
                </h2>
                <p>No data quality incidents detected.</p>
              </div>
            ) : (
              <div className="space-y-8">
                {/* Block 1: Active / New Incidents */}
                {activeIncidents.length > 0 && (
                  <IncidentSection
                    title="Active Incidents"
                    icon={<AlertTriangle className="w-5 h-5 text-red-400" />}
                    count={activeIncidents.length}
                    accentColor="border-red-500/40"
                    incidents={activeIncidents}
                    onOpen={openIncident}
                  />
                )}

                {/* Block 2: Assigned / Acknowledged */}
                {assignedIncidents.length > 0 && (
                  <IncidentSection
                    title="Assigned / In Progress"
                    icon={<UserCheck className="w-5 h-5 text-yellow-400" />}
                    count={assignedIncidents.length}
                    accentColor="border-yellow-500/40"
                    incidents={assignedIncidents}
                    onOpen={openIncident}
                  />
                )}

                {/* Block 3: Resolved */}
                {resolvedIncidents.length > 0 && (
                  <IncidentSection
                    title="Resolved"
                    icon={<CheckCircle2 className="w-5 h-5 text-green-400" />}
                    count={resolvedIncidents.length}
                    accentColor="border-green-500/40"
                    incidents={resolvedIncidents}
                    onOpen={openIncident}
                  />
                )}

                {activeIncidents.length === 0 && assignedIncidents.length === 0 && resolvedIncidents.length === 0 && (
                  <div className="text-center py-12 text-gray-400">
                    <p>No incidents match current filters.</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {view === 'detail' && selectedIncident && (
          <IncidentDetailPanel
            incident={selectedIncident}
            onBack={goBack}
            onUpdate={(updated) => setSelectedIncident(updated)}
          />
        )}
      </main>
    </div>
  );
}

function IncidentSection({
  title,
  icon,
  count,
  accentColor,
  incidents,
  onOpen,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  accentColor: string;
  incidents: IncidentSummary[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className={`border-l-2 ${accentColor} pl-4`}>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h2 className="text-lg font-semibold text-gray-200">{title}</h2>
        <span className="text-xs bg-pulse-card border border-pulse-border rounded-full px-2 py-0.5 text-gray-400">
          {count}
        </span>
      </div>
      <div className="space-y-3">
        {incidents.map((inc) => (
          <IncidentCard
            key={inc.id}
            incident={inc}
            onClick={() => onOpen(inc.id)}
          />
        ))}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="bg-pulse-card border border-pulse-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className={`${color}`}>{icon}</span>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-gray-400 mt-1">{label}</p>
    </div>
  );
}

function EmptyState({
  onRun,
  loading,
}: {
  onRun: () => void;
  loading: boolean;
}) {
  return (
    <div className="text-center py-20">
      <div className="w-24 h-24 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-pulse-border flex items-center justify-center">
        <Activity className="w-12 h-12 text-blue-400" />
      </div>
      <h2 className="text-2xl font-bold text-white mb-3">
        DataPulse Command Center
      </h2>
      <p className="text-gray-400 mb-8 max-w-md mx-auto">
        Run the AI pipeline to scan OpenMetadata for data quality failures,
        trace root causes through lineage, and generate incident reports.
      </p>
      <button
        onClick={onRun}
        disabled={loading}
        className="px-6 py-3 bg-pulse-accent hover:bg-blue-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2"
      >
        {loading ? (
          <>
            <RefreshCw className="w-5 h-5 animate-spin" />
            Running Pipeline…
          </>
        ) : (
          <>
            <Play className="w-5 h-5" />
            Run Incident Pipeline
          </>
        )}
      </button>
    </div>
  );
}

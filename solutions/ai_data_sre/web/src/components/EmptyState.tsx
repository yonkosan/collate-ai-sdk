import { Activity, Play, RefreshCw } from 'lucide-react';

interface EmptyStateProps {
  onRun: () => void;
  loading: boolean;
}

export function EmptyState({ onRun, loading }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 animate-fade-in">
      <div className="w-24 h-24 mb-8 rounded-2xl bg-gradient-to-br from-primary-500/20 to-secondary-500/20 border border-border-subtle flex items-center justify-center shadow-glow">
        <Activity className="w-12 h-12 text-primary-400" />
      </div>
      <h2 className="text-2xl font-bold text-content-primary mb-3 tracking-tight">
        DataPulse Command Center
      </h2>
      <p className="text-content-secondary mb-8 max-w-md mx-auto text-center leading-relaxed">
        Run the AI pipeline to scan OpenMetadata for data quality failures,
        trace root causes through lineage, and generate incident reports.
      </p>
      <button
        onClick={onRun}
        disabled={loading}
        className="px-8 py-3 text-sm font-semibold text-white bg-gradient-cta rounded-xl shadow-glow hover:shadow-glow-strong transition-all disabled:opacity-50 inline-flex items-center gap-2"
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

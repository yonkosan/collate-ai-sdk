import { Zap } from 'lucide-react';

interface PromoCardProps {
  onRunPipeline: () => void;
  loading: boolean;
}

export function PromoCard({ onRunPipeline, loading }: PromoCardProps) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-primary-500/30 bg-gradient-to-br from-primary-900/60 via-secondary-900/40 to-surface-elevated p-4 flex flex-col justify-between shadow-glow">
      {/* Noise */}
      <div className="absolute inset-0 bg-noise opacity-30 pointer-events-none" />

      <div className="relative z-10">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-primary-500/20 text-primary-300 rounded-full border border-primary-500/30 mb-2">
          <Zap className="w-3 h-3" />
          AI-Powered
        </span>
        <h3 className="text-base font-bold text-content-primary mb-1">
          Incident Detection Pipeline
        </h3>
        <p className="text-xs text-content-secondary mb-3 leading-relaxed">
          Automatically scan for data quality failures, trace root causes through lineage, and generate AI-powered incident reports.
        </p>
      </div>

      <div className="relative z-10 space-y-2">
        <button
          onClick={onRunPipeline}
          disabled={loading}
          className="w-full py-2 text-sm font-semibold text-white bg-gradient-cta rounded-xl shadow-glow hover:shadow-glow-strong transition-all disabled:opacity-50"
        >
          {loading ? 'Running Pipeline…' : 'Start Pipeline'}
        </button>
        <div className="flex items-center justify-between text-xs text-content-muted">
          <span>Sentinel → Investigator → Narrator</span>
          <span className="text-primary-400">3 agents</span>
        </div>
      </div>
    </div>
  );
}

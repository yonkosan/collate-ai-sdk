import type { TestHistory } from '../types';
import { RefreshCw } from 'lucide-react';

interface Props {
  history: TestHistory;
}

export function FailureHistoryChart({ history }: Props) {

  return (
    <div className="bg-surface-inset border border-border-subtle rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-content-primary">
            {history.test_case_name}
          </span>
          {history.is_recurring && (
            <span className="inline-flex items-center gap-1 text-xs text-warning bg-warning/10 px-2 py-0.5 rounded-full border border-warning/20">
              <RefreshCw className="w-3 h-3" />
              Recurring
            </span>
          )}
        </div>
        <span className="text-xs text-content-muted">
          {history.failure_count}/{history.total_runs} failed
        </span>
      </div>

      {/* Visual timeline */}
      <div className="flex items-center gap-1">
        {history.results.map((r, i) => {
          const isPass = r.status === 'Success';
          const date = new Date(r.timestamp);
          return (
            <div key={i} className="flex flex-col items-center group relative">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-transform group-hover:scale-125 ${
                  isPass
                    ? 'bg-success/20 text-success border border-success/40'
                    : 'bg-danger/20 text-danger border border-danger/40'
                }`}
              >
                {isPass ? '✓' : '✗'}
              </div>
              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                <div className="bg-surface-elevated text-xs text-content-primary px-2.5 py-1.5 rounded-lg shadow-card border border-border-subtle whitespace-nowrap">
                  {r.status} — {date.toLocaleDateString()}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {history.first_failure && (
        <p className="text-xs text-content-muted mt-2">
          First failure: {new Date(history.first_failure).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

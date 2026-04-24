import type { TestHistory } from '../types';
import { RefreshCw } from 'lucide-react';

interface Props {
  history: TestHistory;
}

export function FailureHistoryChart({ history }: Props) {

  return (
    <div className="bg-pulse-bg border border-pulse-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">
            {history.test_case_name}
          </span>
          {history.is_recurring && (
            <span className="inline-flex items-center gap-1 text-xs text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full border border-yellow-500/20">
              <RefreshCw className="w-3 h-3" />
              Recurring
            </span>
          )}
        </div>
        <span className="text-xs text-gray-500">
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
                    ? 'bg-green-500/20 text-green-400 border border-green-500/40'
                    : 'bg-red-500/20 text-red-400 border border-red-500/40'
                }`}
              >
                {isPass ? '✓' : '✗'}
              </div>
              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                <div className="bg-gray-800 text-xs text-white px-2 py-1 rounded shadow-lg whitespace-nowrap">
                  {r.status} — {date.toLocaleDateString()}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {history.first_failure && (
        <p className="text-xs text-gray-500 mt-2">
          First failure: {new Date(history.first_failure).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

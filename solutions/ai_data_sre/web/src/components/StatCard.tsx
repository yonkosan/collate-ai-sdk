import type { ReactNode } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { Sparkline } from './Sparkline';

interface StatCardProps {
  label: string;
  value: number | string;
  icon: ReactNode;
  delta?: { value: number; label: string };
  sparkData?: number[];
  sparkColor?: string;
  accentColor?: string;
}

export function StatCard({
  label,
  value,
  icon,
  delta,
  sparkData,
  sparkColor = '#8b5cf6',
  accentColor = 'text-primary-400',
}: StatCardProps) {
  const isPositive = delta ? delta.value >= 0 : false;

  return (
    <div className="relative overflow-hidden rounded-xl border border-border-subtle bg-surface-elevated p-5 transition-all hover:border-primary-500/30 hover:shadow-card-hover group">
      {/* Subtle noise texture */}
      <div className="absolute inset-0 bg-noise opacity-30 pointer-events-none" />

      <div className="relative z-10">
        {/* Top row: icon + delta */}
        <div className="flex items-center justify-between mb-3">
          <span
            className={`flex items-center justify-center w-9 h-9 rounded-lg bg-surface-soft border border-border-subtle ${accentColor}`}
          >
            {icon}
          </span>
          {delta && (
            <span
              className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                isPositive
                  ? 'bg-success/10 text-success'
                  : 'bg-danger/10 text-danger'
              }`}
            >
              {isPositive ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              {isPositive ? '+' : ''}
              {delta.value}%
            </span>
          )}
        </div>

        {/* Label */}
        <p className="text-xs font-medium text-content-muted uppercase tracking-wider mb-1">
          {label}
        </p>

        {/* Value */}
        <p className="text-2xl font-bold text-content-primary tracking-tight">
          {value}
        </p>

        {/* Delta label */}
        {delta && (
          <p className="text-xs text-content-faint mt-1">{delta.label}</p>
        )}
      </div>

      {/* Sparkline anchored at bottom */}
      {sparkData && sparkData.length > 1 && (
        <div className="absolute bottom-0 left-0 right-0 opacity-60 group-hover:opacity-80 transition-opacity">
          <Sparkline data={sparkData} color={sparkColor} height={28} />
        </div>
      )}
    </div>
  );
}

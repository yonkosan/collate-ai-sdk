import type { ReactNode } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { Sparkline } from './Sparkline';

interface StatCardProps {
  label: string;
  value: number | string;
  icon: ReactNode;
  delta?: { value: number; label: string };
  /** When true, positive delta is bad (red) — use for metrics where higher = worse */
  invertDelta?: boolean;
  /** Simple text shown below the value — use instead of delta for context without fake % */
  subtitle?: string;
  sparkData?: number[];
  sparkColor?: string;
  accentColor?: string;
}

export function StatCard({
  label,
  value,
  icon,
  delta,
  invertDelta = false,
  subtitle,
  sparkData,
  sparkColor = '#8b5cf6',
  accentColor = 'text-primary-400',
}: StatCardProps) {
  const isPositive = delta ? delta.value >= 0 : false;
  const isGood = invertDelta ? !isPositive : isPositive;

  return (
    <div className="relative overflow-hidden rounded-xl border border-border-subtle bg-surface-elevated p-3.5 transition-all hover:border-primary-500/30 hover:shadow-card-hover group">
      {/* Subtle noise texture */}
      <div className="absolute inset-0 bg-noise opacity-30 pointer-events-none" />

      <div className="relative z-10">
        {/* Top row: icon + delta */}
        <div className="flex items-center justify-between mb-2">
          <span
            className={`flex items-center justify-center w-8 h-8 rounded-lg bg-surface-soft border border-border-subtle ${accentColor}`}
          >
            {icon}
          </span>
          {delta && (
            <span
              className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                isGood
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
        <p className="text-xl font-bold text-content-primary tracking-tight">
          {value}
        </p>

        {/* Delta label */}
        {delta && (
          <p className="text-xs text-content-faint mt-1">{delta.label}</p>
        )}

        {/* Subtitle */}
        {subtitle && !delta && (
          <p className="text-xs text-content-muted mt-1">{subtitle}</p>
        )}
      </div>

      {/* Sparkline anchored at bottom */}
      {sparkData && sparkData.length > 1 && (
        <div className="absolute bottom-0 left-0 right-0 opacity-60 group-hover:opacity-80 transition-opacity">
          <Sparkline data={sparkData} color={sparkColor} height={22} />
        </div>
      )}
    </div>
  );
}

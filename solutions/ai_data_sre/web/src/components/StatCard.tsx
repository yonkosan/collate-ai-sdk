import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Info, TrendingDown, TrendingUp, X } from 'lucide-react';
import { Sparkline } from './Sparkline';
import { SEVERITY_CONFIG, DEFAULT_SEVERITY_CONFIG } from '../data/constants';
import type { IncidentSummary } from '../types';

/* ── Relative-time helper ──────────────────────────────────────────────── */

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ── Mini incident row ─────────────────────────────────────────────────── */

interface MiniRowProps {
  inc: IncidentSummary;
  showRecurring?: boolean;
}

function MiniRow({ inc, showRecurring }: MiniRowProps) {
  const sev = SEVERITY_CONFIG[inc.severity] ?? DEFAULT_SEVERITY_CONFIG;
  const table = inc.root_cause_table.split('.').pop() ?? inc.root_cause_table;
  const isResolved = inc.status === 'resolved';

  return (
    <div className={`flex items-center gap-1.5 py-[3px] px-1 rounded text-[10px] leading-tight ${isResolved ? 'opacity-60' : ''}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sev.dot}`} />
      <span className="flex-1 truncate text-content-primary font-medium">{table}</span>
      {showRecurring && inc.has_recurring_failures && (
        <span className="text-[9px] px-1 py-px bg-warning/15 text-warning rounded font-semibold flex-shrink-0">
          recurring
        </span>
      )}
      {isResolved && (
        <span className="text-[9px] px-1 py-px bg-emerald-500/15 text-emerald-400 rounded flex-shrink-0">
          resolved
        </span>
      )}
      <span className="text-content-faint flex-shrink-0 tabular-nums">{timeAgo(inc.created_at)}</span>
    </div>
  );
}

/* ── Expanded modal ────────────────────────────────────────────────────── */

interface ModalProps {
  label: string;
  items: IncidentSummary[];
  showRecurring?: boolean;
  onClose: () => void;
}

function CardModal({ label, items, showRecurring, onClose }: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-surface-elevated border border-border-subtle rounded-2xl w-full max-w-md max-h-[70vh] flex flex-col shadow-2xl animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle">
          <h3 className="text-sm font-bold text-content-primary">{label}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-soft text-content-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {items.map((inc) => {
            const sev = SEVERITY_CONFIG[inc.severity] ?? DEFAULT_SEVERITY_CONFIG;
            const table = inc.root_cause_table.split('.').pop() ?? inc.root_cause_table;
            const isResolved = inc.status === 'resolved';

            return (
              <div
                key={inc.id}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border ${
                  isResolved ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'
                }`}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${sev.dot}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-content-primary truncate">{inc.title}</p>
                  <p className="text-[10px] text-content-muted truncate">{table} · {inc.failure_count} failure{inc.failure_count !== 1 ? 's' : ''}</p>
                </div>
                <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                  <span className={`text-[10px] font-semibold ${sev.text}`}>{inc.severity}</span>
                  <span className="text-[10px] text-content-faint tabular-nums">{timeAgo(inc.created_at)}</span>
                  {showRecurring && inc.has_recurring_failures && (
                    <span className="text-[9px] px-1 py-px bg-warning/15 text-warning rounded font-semibold">recurring</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-5 py-2.5 border-t border-border-subtle text-center">
          <span className="text-[11px] text-content-faint">{items.length} incident{items.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  );
}

/* ── Info Tooltip ───────────────────────────────────────────────────────── */

function InfoTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleEnter = () => {
    clearTimeout(timeoutRef.current);
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    }
    setShow(true);
  };
  const handleLeave = () => {
    timeoutRef.current = setTimeout(() => setShow(false), 150);
  };

  return (
    <div onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <button
        ref={btnRef}
        type="button"
        className="flex items-center justify-center w-5 h-5 rounded-full text-content-faint hover:text-content-muted hover:bg-surface-soft transition-colors"
        aria-label="Info"
        onClick={(e) => e.stopPropagation()}
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {show && pos && (
        <div
          className="fixed z-[9999] w-56 px-3 py-2.5 rounded-xl border border-border-subtle bg-surface-elevated shadow-2xl animate-fade-in"
          style={{ top: pos.top, right: pos.right }}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        >
          <p className="text-[11px] text-content-secondary leading-relaxed">{text}</p>
        </div>
      )}
    </div>
  );
}

export { InfoTooltip };

/* ── StatCard ──────────────────────────────────────────────────────────── */

interface StatCardProps {
  label: string;
  value: number | string;
  icon: ReactNode;
  delta?: { value: number; label: string };
  invertDelta?: boolean;
  subtitle?: string;
  /** Tooltip text shown on hover of the info icon */
  tooltip?: string;
  /** Incidents to show in the mini-list within the card */
  items?: IncidentSummary[];
  /** Show recurring badges in the list */
  showRecurring?: boolean;
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
  tooltip,
  items,
  showRecurring,
  sparkData,
  sparkColor = '#8b5cf6',
  accentColor = 'text-primary-400',
}: StatCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isPositive = delta ? delta.value >= 0 : false;
  const isGood = invertDelta ? !isPositive : isPositive;

  const handleClick = useCallback(() => {
    if (items && items.length > 0) setExpanded(true);
  }, [items]);

  return (
    <>
      <div
        onClick={handleClick}
        className={`relative overflow-hidden rounded-xl border border-border-subtle bg-surface-elevated p-3.5 transition-all hover:border-primary-500/30 hover:shadow-card-hover group flex flex-col ${
          items && items.length > 0 ? 'cursor-pointer' : ''
        }`}
        style={{ minHeight: 160 }}
      >
        {/* Noise texture */}
        <div className="absolute inset-0 bg-noise opacity-30 pointer-events-none" />

        <div className="relative z-10 flex-shrink-0">
          {/* Top row: icon + delta + info */}
          <div className="flex items-center justify-between mb-1.5">
            <span className={`flex items-center justify-center w-7 h-7 rounded-lg bg-surface-soft border border-border-subtle ${accentColor}`}>
              {icon}
            </span>
            <div className="flex items-center gap-1.5">
              {delta && (
                <span className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                  isGood ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
                }`}>
                  {isPositive ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                  {isPositive ? '+' : ''}{delta.value}%
                </span>
              )}
              {tooltip && <InfoTooltip text={tooltip} />}
            </div>
          </div>

          {/* Label + Value inline */}
          <p className="text-[10px] font-medium text-content-muted uppercase tracking-wider">{label}</p>
          <p className="text-lg font-bold text-content-primary tracking-tight leading-tight">{value}</p>

          {/* Subtitle */}
          {subtitle && !delta && (
            <p className="text-[10px] text-content-muted mt-0.5">{subtitle}</p>
          )}
          {delta && (
            <p className="text-[10px] text-content-faint mt-0.5">{delta.label}</p>
          )}
        </div>

        {/* Mini incident list */}
        {items && items.length > 0 && (
          <div className="relative z-10 flex-1 mt-1.5 overflow-y-auto min-h-0 -mx-1" style={{ maxHeight: 52 }}>
            {items.slice(0, 8).map((inc) => (
              <MiniRow key={inc.id} inc={inc} showRecurring={showRecurring} />
            ))}
            {items.length > 8 && (
              <p className="text-[9px] text-content-faint text-center py-0.5">+{items.length - 8} more — click to expand</p>
            )}
          </div>
        )}

        {/* Click hint */}
        {items && items.length > 0 && (
          <p className="relative z-10 text-[9px] text-content-faint text-center mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
            click to expand
          </p>
        )}

        {/* Sparkline */}
        {sparkData && sparkData.length > 1 && (
          <div className="absolute bottom-0 left-0 right-0 opacity-40 group-hover:opacity-60 transition-opacity">
            <Sparkline data={sparkData} color={sparkColor} height={18} />
          </div>
        )}
      </div>

      {/* Expanded modal */}
      {expanded && items && (
        <CardModal
          label={label}
          items={items}
          showRecurring={showRecurring}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  );
}

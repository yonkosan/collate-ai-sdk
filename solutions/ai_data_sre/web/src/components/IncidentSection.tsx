import type { ReactNode } from 'react';
import type { IncidentSummary } from '../types';
import { IncidentCard } from './IncidentCard';

interface IncidentSectionProps {
  title: string;
  icon: ReactNode;
  count: number;
  accentColor: string;
  incidents: IncidentSummary[];
  onOpen: (id: string) => void;
}

export function IncidentSection({
  title,
  icon,
  count,
  accentColor,
  incidents,
  onOpen,
}: IncidentSectionProps) {
  return (
    <div className={`border-l-2 ${accentColor} pl-5`}>
      <div className="flex items-center gap-2.5 mb-4">
        {icon}
        <h2 className="text-base font-semibold text-content-primary">{title}</h2>
        <span className="text-xs font-medium bg-surface-soft border border-border-subtle rounded-full px-2.5 py-0.5 text-content-muted">
          {count}
        </span>
      </div>
      <div className="space-y-3">
        {incidents.map((inc) => (
          <IncidentCard key={inc.id} incident={inc} onClick={() => onOpen(inc.id)} />
        ))}
      </div>
    </div>
  );
}

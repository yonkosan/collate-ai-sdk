import type { IncidentSummary } from '../types';

export interface NavItem {
  id: string;
  label: string;
  icon: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard' },
  { id: 'incidents', label: 'Incidents', icon: 'alert-triangle' },
  { id: 'lineage', label: 'Lineage', icon: 'git-branch' },
  { id: 'reports', label: 'Reports', icon: 'file-text' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

export const SEVERITY_CONFIG: Record<
  string,
  { bg: string; text: string; border: string; badge: string; dot: string }
> = {
  CRITICAL: {
    bg: 'bg-danger/10',
    text: 'text-danger',
    border: 'border-danger/30',
    badge: 'bg-danger text-white badge-critical',
    dot: 'bg-danger',
  },
  HIGH: {
    bg: 'bg-orange-500/10',
    text: 'text-orange-400',
    border: 'border-orange-500/30',
    badge: 'bg-orange-500 text-white',
    dot: 'bg-orange-500',
  },
  MEDIUM: {
    bg: 'bg-warning/10',
    text: 'text-warning',
    border: 'border-warning/30',
    badge: 'bg-warning text-black',
    dot: 'bg-warning',
  },
  LOW: {
    bg: 'bg-success/10',
    text: 'text-success',
    border: 'border-success/30',
    badge: 'bg-success text-black',
    dot: 'bg-success',
  },
  INFO: {
    bg: 'bg-content-muted/10',
    text: 'text-content-muted',
    border: 'border-content-muted/30',
    badge: 'bg-content-muted text-white',
    dot: 'bg-content-muted',
  },
};

export const DEFAULT_SEVERITY_CONFIG = {
  bg: 'bg-content-muted/10',
  text: 'text-content-muted',
  border: 'border-content-muted/30',
  badge: 'bg-content-muted text-white',
  dot: 'bg-content-muted',
};

export const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  detected: { color: 'text-danger', label: 'Detected' },
  investigating: { color: 'text-warning', label: 'Investigating' },
  reported: { color: 'text-info', label: 'Reported' },
  acknowledged: { color: 'text-primary-400', label: 'Acknowledged' },
  resolve_pending: { color: 'text-warning', label: 'Verifying…' },
  resolved_verified: { color: 'text-success', label: 'Verified' },
  resolved_failed: { color: 'text-danger', label: 'Verify Failed' },
  resolved: { color: 'text-success', label: 'Resolved' },
};

export function sortBySeverity(incidents: IncidentSummary[]): IncidentSummary[] {
  return [...incidents].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
  );
}

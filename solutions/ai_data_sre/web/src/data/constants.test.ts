import { describe, it, expect } from 'vitest';
import {
  SEVERITY_CONFIG,
  SEVERITY_ORDER,
  STATUS_CONFIG,
  DEFAULT_SEVERITY_CONFIG,
  NAV_ITEMS,
  sortBySeverity,
} from '../data/constants';
import { makeSummary } from '../test/fixtures';

describe('SEVERITY_ORDER', () => {
  it('ranks CRITICAL as highest priority (lowest number)', () => {
    expect(SEVERITY_ORDER['CRITICAL']).toBe(0);
  });

  it('ranks INFO as lowest priority', () => {
    expect(SEVERITY_ORDER['INFO']).toBe(4);
  });

  it('has all five severity levels', () => {
    expect(Object.keys(SEVERITY_ORDER)).toEqual(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
  });
});

describe('SEVERITY_CONFIG', () => {
  it('has config for all severity levels', () => {
    for (const sev of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']) {
      const config = SEVERITY_CONFIG[sev];
      expect(config).toBeDefined();
      expect(config).toHaveProperty('bg');
      expect(config).toHaveProperty('text');
      expect(config).toHaveProperty('border');
      expect(config).toHaveProperty('badge');
      expect(config).toHaveProperty('dot');
    }
  });
});

describe('DEFAULT_SEVERITY_CONFIG', () => {
  it('has all required keys', () => {
    expect(DEFAULT_SEVERITY_CONFIG).toHaveProperty('bg');
    expect(DEFAULT_SEVERITY_CONFIG).toHaveProperty('text');
    expect(DEFAULT_SEVERITY_CONFIG).toHaveProperty('dot');
  });
});

describe('STATUS_CONFIG', () => {
  it('has config for all statuses', () => {
    for (const s of ['detected', 'investigating', 'reported', 'acknowledged', 'resolved']) {
      const config = STATUS_CONFIG[s];
      expect(config).toBeDefined();
      expect(config).toHaveProperty('color');
      expect(config).toHaveProperty('label');
    }
  });

  it('labels match expected display names', () => {
    expect(STATUS_CONFIG['detected']!.label).toBe('Detected');
    expect(STATUS_CONFIG['resolved']!.label).toBe('Resolved');
  });
});

describe('NAV_ITEMS', () => {
  it('has at least 4 items', () => {
    expect(NAV_ITEMS.length).toBeGreaterThanOrEqual(4);
  });

  it('includes dashboard as first item', () => {
    expect(NAV_ITEMS[0]!.id).toBe('dashboard');
  });

  it('each item has id, label, and icon', () => {
    for (const item of NAV_ITEMS) {
      expect(item.id).toBeTruthy();
      expect(item.label).toBeTruthy();
      expect(item.icon).toBeTruthy();
    }
  });
});

describe('sortBySeverity', () => {
  it('sorts CRITICAL before HIGH', () => {
    const incidents = [
      makeSummary({ id: 'h', severity: 'HIGH' }),
      makeSummary({ id: 'c', severity: 'CRITICAL' }),
    ];
    const sorted = sortBySeverity(incidents);
    expect(sorted[0]!.id).toBe('c');
    expect(sorted[1]!.id).toBe('h');
  });

  it('sorts all severities in correct order', () => {
    const incidents = [
      makeSummary({ id: 'l', severity: 'LOW' }),
      makeSummary({ id: 'c', severity: 'CRITICAL' }),
      makeSummary({ id: 'm', severity: 'MEDIUM' }),
      makeSummary({ id: 'i', severity: 'INFO' }),
      makeSummary({ id: 'h', severity: 'HIGH' }),
    ];
    const sorted = sortBySeverity(incidents);
    expect(sorted.map((s) => s.severity)).toEqual([
      'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO',
    ]);
  });

  it('does not mutate the original array', () => {
    const incidents = [
      makeSummary({ id: 'h', severity: 'HIGH' }),
      makeSummary({ id: 'c', severity: 'CRITICAL' }),
    ];
    sortBySeverity(incidents);
    expect(incidents[0]!.id).toBe('h');
  });

  it('handles empty array', () => {
    expect(sortBySeverity([])).toEqual([]);
  });

  it('handles unknown severity gracefully', () => {
    const incidents = [
      makeSummary({ id: 'u', severity: 'UNKNOWN' as 'CRITICAL' }),
      makeSummary({ id: 'c', severity: 'CRITICAL' }),
    ];
    const sorted = sortBySeverity(incidents);
    expect(sorted[0]!.id).toBe('c');
  });
});

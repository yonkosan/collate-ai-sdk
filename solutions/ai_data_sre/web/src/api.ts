import type {
  FixResult,
  FixSuggestion,
  GuardrailResult,
  IncidentDetail,
  IncidentSummary,
  PipelineResponse,
  RerunResult,
  UserInfo,
  VerificationResult,
} from './types';
import { getDemoDetail, DEMO_ACTIVE_SUMMARIES } from './data/seedDetails';

const BASE = '/api';

/* ── Demo mode detection ─────────────────────────────────────────────── */

let _demoMode: boolean | null = null;

function isStaticHost(): boolean {
  // No backend on Vercel, Netlify, GitHub Pages, or any non-localhost host
  const h = window.location.hostname;
  return h !== 'localhost' && h !== '127.0.0.1';
}

async function checkDemoMode(): Promise<boolean> {
  if (_demoMode !== null) return _demoMode;
  // Fast path: if not running locally, there's no backend
  if (isStaticHost()) {
    _demoMode = true;
    return true;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(`${BASE}/health`, { signal: controller.signal });
    clearTimeout(timer);
    const ct = resp.headers.get('content-type') ?? '';
    _demoMode = !resp.ok || !ct.includes('application/json');
  } catch {
    _demoMode = true;
  }
  return _demoMode;
}

export function isDemoMode(): boolean {
  return _demoMode === true;
}

export function initDemoCheck(): Promise<boolean> {
  return checkDemoMode();
}

/* ── Network layer ───────────────────────────────────────────────────── */

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  // Safety net: if demo mode, never make real API calls
  if (await checkDemoMode()) {
    throw new Error('Demo mode — no backend available');
  }
  const resp = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`API error ${resp.status}: ${body}`);
  }
  return resp.json() as Promise<T>;
}

export interface ResolveResponse {
  status: 'resolved' | 'rejected';
  incident_id: string;
  resolved_by?: string;
  resolution_note?: string;
  message?: string;
  still_failing_tests?: string[];
  verification?: VerificationResult | null;
}

export const api = {
  runPipeline: async (): Promise<PipelineResponse> => {
    if (await checkDemoMode()) {
      return { status: 'demo', incident_count: DEMO_ACTIVE_SUMMARIES.length, incidents: DEMO_ACTIVE_SUMMARIES };
    }
    return fetchJSON<PipelineResponse>('/pipeline/run', { method: 'POST' });
  },
  listIncidents: async (): Promise<IncidentSummary[]> => {
    if (await checkDemoMode()) return DEMO_ACTIVE_SUMMARIES;
    return fetchJSON<IncidentSummary[]>('/incidents');
  },
  getIncident: async (id: string): Promise<IncidentDetail> => {
    if (await checkDemoMode()) {
      const d = getDemoDetail(id);
      if (d) return d;
      throw new Error(`Incident ${id} not found in demo data`);
    }
    return fetchJSON<IncidentDetail>(`/incidents/${id}`);
  },
  acknowledgeIncident: async (id: string, acknowledgedBy = 'admin') => {
    if (await checkDemoMode()) return { status: 'demo' };
    return fetchJSON<{ status: string }>(`/incidents/${id}/ack`, {
      method: 'PUT',
      body: JSON.stringify({ acknowledged_by: acknowledgedBy }),
    });
  },
  assignIncident: async (id: string, assignee: string) => {
    if (await checkDemoMode()) return { status: 'demo' };
    return fetchJSON<{ status: string }>(`/incidents/${id}/assign`, {
      method: 'PUT',
      body: JSON.stringify({ assignee }),
    });
  },
  resolveIncident: async (
    id: string,
    resolutionNote: string,
    resolvedBy = 'admin',
    resolutionCategory = '',
    skipVerification = false,
  ) => {
    if (await checkDemoMode()) return { status: 'resolved' as const, incident_id: id, resolved_by: resolvedBy, resolution_note: resolutionNote };
    return fetchJSON<ResolveResponse>(`/incidents/${id}/resolve`, {
      method: 'PUT',
      body: JSON.stringify({
        resolution_note: resolutionNote,
        resolved_by: resolvedBy,
        resolution_category: resolutionCategory,
        skip_verification: skipVerification,
      }),
    });
  },
  verifyIncident: async (id: string) => {
    if (await checkDemoMode()) return { passed: true, message: 'Demo mode — verification simulated', still_failing_tests: [] as string[], verified_at: new Date().toISOString() };
    return fetchJSON<{ passed: boolean; message: string; still_failing_tests: string[]; verified_at: string }>(
      `/incidents/${id}/verify`,
      { method: 'POST' },
    );
  },
  suggestFix: async (id: string) => {
    if (await checkDemoMode()) return { incident_id: id, suggestions: [] as FixSuggestion[] };
    return fetchJSON<{
      incident_id: string;
      suggestions: FixSuggestion[];
    }>(`/incidents/${id}/suggest-fix`, { method: 'POST' });
  },
  executeFix: async (id: string, sql: string) => {
    if (await checkDemoMode()) return { success: true, message: 'Demo mode — fix simulated', rows_affected: 0, executed_sql: sql, executed_at: new Date().toISOString() };
    return fetchJSON<FixResult>(`/incidents/${id}/execute-fix`, {
      method: 'POST',
      body: JSON.stringify({ sql }),
    });
  },
  rerunTest: async (id: string, testCaseId: string, testCaseName: string) => {
    if (await checkDemoMode()) return { test_case_name: testCaseName, status: 'Success' as const, message: 'Demo mode — test simulated', timestamp: new Date().toISOString() };
    return fetchJSON<RerunResult>(`/incidents/${id}/rerun-test`, {
      method: 'POST',
      body: JSON.stringify({ test_case_id: testCaseId, test_case_name: testCaseName }),
    });
  },
  addGuardrail: async (
    id: string,
    name: string,
    testDefinition: string,
    entityLink: string,
    parameterValues: { name: string; value: string }[] = [],
    description = '',
  ) => {
    if (await checkDemoMode()) return { success: true, message: 'Demo mode — guardrail simulated', test_case_name: name, test_case_id: 'demo', om_link: 'https://sandbox.open-metadata.org', created_at: new Date().toISOString() };
    return fetchJSON<GuardrailResult>(`/incidents/${id}/add-guardrail`, {
      method: 'POST',
      body: JSON.stringify({
        name,
        test_definition: testDefinition,
        entity_link: entityLink,
        parameter_values: parameterValues,
        description,
      }),
    });
  },
  listUsers: async (q = ''): Promise<UserInfo[]> => {
    if (await checkDemoMode()) {
      return [
        { name: 'admin', display_name: 'Admin' },
        { name: 'alice', display_name: 'Alice Chen' },
        { name: 'bob', display_name: 'Bob Martinez' },
      ];
    }
    return fetchJSON<UserInfo[]>(`/users${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  },
  listTeams: async () => {
    if (await checkDemoMode()) return [{ name: 'data-engineering', display_name: 'Data Engineering' }, { name: 'analytics', display_name: 'Analytics' }];
    return fetchJSON<UserInfo[]>('/teams');
  },
  getOmLink: async (entityType: string, fqn: string) => {
    if (await checkDemoMode()) return { link: `https://sandbox.open-metadata.org/${entityType}/${fqn}` };
    return fetchJSON<{ link: string }>(`/om/link/${entityType}/${fqn}`);
  },
  getConfig: async (): Promise<{ om_base_url: string }> => {
    if (await checkDemoMode()) return { om_base_url: 'https://sandbox.open-metadata.org' };
    return fetchJSON<{ om_base_url: string }>('/config');
  },
};

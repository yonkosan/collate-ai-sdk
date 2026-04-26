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

async function checkDemoMode(): Promise<boolean> {
  if (_demoMode !== null) return _demoMode;
  try {
    const resp = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
    _demoMode = !resp.ok;
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
    }
    return fetchJSON<IncidentDetail>(`/incidents/${id}`);
  },
  acknowledgeIncident: (id: string, acknowledgedBy = 'admin') =>
    fetchJSON<{ status: string }>(`/incidents/${id}/ack`, {
      method: 'PUT',
      body: JSON.stringify({ acknowledged_by: acknowledgedBy }),
    }),
  assignIncident: (id: string, assignee: string) =>
    fetchJSON<{ status: string }>(`/incidents/${id}/assign`, {
      method: 'PUT',
      body: JSON.stringify({ assignee }),
    }),
  resolveIncident: (
    id: string,
    resolutionNote: string,
    resolvedBy = 'admin',
    resolutionCategory = '',
    skipVerification = false,
  ) =>
    fetchJSON<ResolveResponse>(`/incidents/${id}/resolve`, {
      method: 'PUT',
      body: JSON.stringify({
        resolution_note: resolutionNote,
        resolved_by: resolvedBy,
        resolution_category: resolutionCategory,
        skip_verification: skipVerification,
      }),
    }),
  verifyIncident: (id: string) =>
    fetchJSON<{ passed: boolean; message: string; still_failing_tests: string[]; verified_at: string }>(
      `/incidents/${id}/verify`,
      { method: 'POST' },
    ),
  suggestFix: (id: string) =>
    fetchJSON<{
      incident_id: string;
      suggestions: FixSuggestion[];
    }>(`/incidents/${id}/suggest-fix`, { method: 'POST' }),
  executeFix: (id: string, sql: string) =>
    fetchJSON<FixResult>(`/incidents/${id}/execute-fix`, {
      method: 'POST',
      body: JSON.stringify({ sql }),
    }),
  rerunTest: (id: string, testCaseId: string, testCaseName: string) =>
    fetchJSON<RerunResult>(`/incidents/${id}/rerun-test`, {
      method: 'POST',
      body: JSON.stringify({ test_case_id: testCaseId, test_case_name: testCaseName }),
    }),
  addGuardrail: (
    id: string,
    name: string,
    testDefinition: string,
    entityLink: string,
    parameterValues: { name: string; value: string }[] = [],
    description = '',
  ) =>
    fetchJSON<GuardrailResult>(`/incidents/${id}/add-guardrail`, {
      method: 'POST',
      body: JSON.stringify({
        name,
        test_definition: testDefinition,
        entity_link: entityLink,
        parameter_values: parameterValues,
        description,
      }),
    }),
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
  listTeams: () => fetchJSON<UserInfo[]>('/teams'),
  getOmLink: (entityType: string, fqn: string) =>
    fetchJSON<{ link: string }>(`/om/link/${entityType}/${fqn}`),
  getConfig: async (): Promise<{ om_base_url: string }> => {
    if (await checkDemoMode()) return { om_base_url: 'https://sandbox.open-metadata.org' };
    return fetchJSON<{ om_base_url: string }>('/config');
  },
};

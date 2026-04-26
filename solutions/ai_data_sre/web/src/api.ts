import type {
  IncidentDetail,
  IncidentSummary,
  PipelineResponse,
  UserInfo,
  VerificationResult,
} from './types';

const BASE = '/api';

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
  runPipeline: () => fetchJSON<PipelineResponse>('/pipeline/run', { method: 'POST' }),
  listIncidents: () => fetchJSON<IncidentSummary[]>('/incidents'),
  getIncident: (id: string) => fetchJSON<IncidentDetail>(`/incidents/${id}`),
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
  listUsers: (q = '') => fetchJSON<UserInfo[]>(`/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  listTeams: () => fetchJSON<UserInfo[]>('/teams'),
  getOmLink: (entityType: string, fqn: string) =>
    fetchJSON<{ link: string }>(`/om/link/${entityType}/${fqn}`),
  getConfig: () => fetchJSON<{ om_base_url: string }>('/config'),
};

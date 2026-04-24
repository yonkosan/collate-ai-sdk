import type {
  IncidentDetail,
  IncidentSummary,
  PipelineResponse,
  UserInfo,
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

export const api = {
  runPipeline: () => fetchJSON<PipelineResponse>('/pipeline/run', { method: 'POST' }),
  listIncidents: () => fetchJSON<IncidentSummary[]>('/incidents'),
  getIncident: (id: string) => fetchJSON<IncidentDetail>(`/incidents/${id}`),
  acknowledgeIncident: (id: string) =>
    fetchJSON<{ status: string }>(`/incidents/${id}/ack`, { method: 'PUT', body: '{}' }),
  assignIncident: (id: string, assignee: string) =>
    fetchJSON<{ status: string }>(`/incidents/${id}/assign`, {
      method: 'PUT',
      body: JSON.stringify({ assignee }),
    }),
  resolveIncident: (id: string, resolutionNote: string) =>
    fetchJSON<{ status: string }>(`/incidents/${id}/resolve`, {
      method: 'PUT',
      body: JSON.stringify({ resolution_note: resolutionNote }),
    }),
  listUsers: () => fetchJSON<UserInfo[]>('/users'),
  listTeams: () => fetchJSON<UserInfo[]>('/teams'),
  getOmLink: (entityType: string, fqn: string) =>
    fetchJSON<{ link: string }>(`/om/link/${entityType}/${fqn}`),
};

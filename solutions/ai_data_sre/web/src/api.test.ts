import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from './api';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('api.runPipeline', () => {
  it('sends POST to /api/pipeline/run', async () => {
    const body = { status: 'completed', incident_count: 0, incidents: [] };
    mockFetch.mockResolvedValue(jsonResponse(body));

    const result = await api.runPipeline();

    expect(mockFetch).toHaveBeenCalledWith('/api/pipeline/run', expect.objectContaining({
      method: 'POST',
    }));
    expect(result).toEqual(body);
  });
});

describe('api.listIncidents', () => {
  it('sends GET to /api/incidents', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));

    const result = await api.listIncidents();

    expect(mockFetch).toHaveBeenCalledWith('/api/incidents', expect.any(Object));
    expect(result).toEqual([]);
  });
});

describe('api.getIncident', () => {
  it('sends GET to /api/incidents/:id', async () => {
    const detail = { id: 'inc-1' };
    mockFetch.mockResolvedValue(jsonResponse(detail));

    const result = await api.getIncident('inc-1');

    expect(mockFetch).toHaveBeenCalledWith('/api/incidents/inc-1', expect.any(Object));
    expect(result).toEqual(detail);
  });
});

describe('api.acknowledgeIncident', () => {
  it('sends PUT with acknowledged_by', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: 'acknowledged' }));

    await api.acknowledgeIncident('inc-1', 'alice');

    expect(mockFetch).toHaveBeenCalledWith('/api/incidents/inc-1/ack', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ acknowledged_by: 'alice' }),
    }));
  });

  it('defaults acknowledged_by to admin', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: 'acknowledged' }));

    await api.acknowledgeIncident('inc-1');

    const call = mockFetch.mock.calls[0]!;
    expect(JSON.parse(call[1].body)).toEqual({ acknowledged_by: 'admin' });
  });
});

describe('api.assignIncident', () => {
  it('sends PUT with assignee', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: 'assigned' }));

    await api.assignIncident('inc-1', 'bob');

    expect(mockFetch).toHaveBeenCalledWith('/api/incidents/inc-1/assign', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ assignee: 'bob' }),
    }));
  });
});

describe('api.resolveIncident', () => {
  it('sends PUT with resolution_note and resolved_by', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: 'resolved' }));

    await api.resolveIncident('inc-1', 'Fixed the data', 'alice');

    expect(mockFetch).toHaveBeenCalledWith('/api/incidents/inc-1/resolve', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ resolution_note: 'Fixed the data', resolved_by: 'alice' }),
    }));
  });
});

describe('api.listUsers', () => {
  it('sends GET to /api/users without query', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));

    await api.listUsers();

    expect(mockFetch).toHaveBeenCalledWith('/api/users', expect.any(Object));
  });

  it('includes query parameter when provided', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));

    await api.listUsers('alice');

    expect(mockFetch).toHaveBeenCalledWith('/api/users?q=alice', expect.any(Object));
  });
});

describe('api.getConfig', () => {
  it('returns om_base_url', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ om_base_url: 'http://localhost:8585' }));

    const result = await api.getConfig();

    expect(result.om_base_url).toBe('http://localhost:8585');
  });
});

describe('error handling', () => {
  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    await expect(api.listIncidents()).rejects.toThrow('API error 500: Internal Server Error');
  });
});

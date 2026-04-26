import type {
  IncidentSummary,
  IncidentDetail,
  TestFailure,
  BlastRadius,
  IncidentReport,
  UserInfo,
  PipelineResponse,
} from '../types';

export const mockFailure: TestFailure = {
  test_case_id: 'tc-001',
  test_case_name: 'columnValuesToBeNotNull',
  table_fqn: 'supply_chain.raw_orders',
  column: 'order_date',
  test_definition: 'columnValuesToBeNotNull',
  result_message: '847 rows have null order_date',
  timestamp: '2026-04-25T10:00:00Z',
  faulty_rows: [
    { row_data: { id: '1', order_date: '' }, reason: 'null value' },
  ],
};

export const mockBlastRadius: BlastRadius = {
  root_cause_table: 'supply_chain.raw_orders',
  root_cause_column: 'order_date',
  upstream_chain: [],
  downstream_impact: [
    {
      fqn: 'supply_chain.stg_orders',
      entity_type: 'table',
      display_name: 'stg_orders',
      description: 'Staged orders',
      owners: ['data_team'],
      tier: 'Tier.Tier2',
      domain: null,
      tags: [],
      depth: 1,
    },
  ],
  total_affected_assets: 3,
  affected_owners: ['data_team'],
};

export const mockReport: IncidentReport = {
  summary: 'Data quality failure in raw_orders table',
  root_cause_analysis: '847 rows contain future-dated order_date values',
  blast_radius_description: '3 downstream tables affected',
  severity_justification: 'Critical due to wide blast radius',
  recommendations: ['Fix source data', 'Add validation rules'],
  stakeholders_affected: 'Analytics team, Finance team',
  trend_analysis: 'First occurrence',
  generated_at: '2026-04-25T10:05:00Z',
};

export const mockIncidentSummary: IncidentSummary = {
  id: 'inc-001',
  title: 'DQ failures in raw_orders',
  severity: 'CRITICAL',
  status: 'detected',
  failure_count: 2,
  blast_radius_size: 3,
  root_cause_table: 'supply_chain.raw_orders',
  assigned_to: null,
  acknowledged_by: null,
  resolved_by: null,
  slack_thread_url: null,
  created_at: '2026-04-25T10:00:00Z',
  has_report: true,
  has_recurring_failures: false,
};

export const mockIncidentDetail: IncidentDetail = {
  id: 'inc-001',
  title: 'DQ failures in raw_orders',
  severity: 'CRITICAL',
  status: 'detected',
  failures: [mockFailure],
  failure_histories: [],
  blast_radius: mockBlastRadius,
  report: mockReport,
  assigned_to: null,
  acknowledged_by: null,
  resolved_by: null,
  slack_thread_url: null,
  resolution_note: null,
  resolution_category: null,
  verification_result: null,
  events: [],
  acknowledged_at: null,
  resolved_at: null,
  created_at: '2026-04-25T10:00:00Z',
  updated_at: '2026-04-25T10:05:00Z',
};

export const mockUsers: UserInfo[] = [
  { name: 'admin', display_name: 'Admin User' },
  { name: 'alice', display_name: 'Alice Engineer' },
  { name: 'bob', display_name: 'Bob Analyst' },
];

export const mockPipelineResponse: PipelineResponse = {
  status: 'completed',
  incident_count: 1,
  incidents: [mockIncidentSummary],
};

export function makeSummary(overrides: Partial<IncidentSummary> = {}): IncidentSummary {
  return { ...mockIncidentSummary, ...overrides };
}

export function makeDetail(overrides: Partial<IncidentDetail> = {}): IncidentDetail {
  return { ...mockIncidentDetail, ...overrides };
}

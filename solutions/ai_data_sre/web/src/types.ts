export interface IncidentSummary {
  id: string;
  title: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  status: string;
  failure_count: number;
  blast_radius_size: number;
  root_cause_table: string;
  assigned_to: string | null;
  acknowledged_by: string | null;
  resolved_by: string | null;
  slack_thread_url: string | null;
  created_at: string;
  has_report: boolean;
  has_recurring_failures: boolean;
}

export interface FaultyRow {
  row_data: Record<string, string>;
  reason: string;
}

export interface TestFailure {
  test_case_id: string;
  test_case_name: string;
  table_fqn: string;
  column: string | null;
  test_definition: string;
  result_message: string;
  timestamp: string;
  faulty_rows: FaultyRow[];
}

export interface TestResultRecord {
  timestamp: string;
  status: string;
  result_message: string;
}

export interface TestHistory {
  test_case_name: string;
  results: TestResultRecord[];
  total_runs: number;
  failure_count: number;
  first_failure: string | null;
  is_recurring: boolean;
}

export interface AffectedAsset {
  fqn: string;
  entity_type: string;
  display_name: string | null;
  description: string | null;
  owners: string[];
  tier: string | null;
  domain: string | null;
  tags: string[];
  depth: number;
}

export interface BlastRadius {
  root_cause_table: string;
  root_cause_column: string | null;
  upstream_chain: AffectedAsset[];
  downstream_impact: AffectedAsset[];
  total_affected_assets: number;
  affected_owners: string[];
}

export interface IncidentReport {
  summary: string;
  root_cause_analysis: string;
  blast_radius_description: string;
  severity_justification: string;
  recommendations: string[];
  stakeholders_affected: string;
  trend_analysis: string;
  generated_at: string;
}

export interface IncidentDetail {
  id: string;
  title: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  status: string;
  failures: TestFailure[];
  failure_histories: TestHistory[];
  blast_radius: BlastRadius | null;
  report: IncidentReport | null;
  assigned_to: string | null;
  acknowledged_by: string | null;
  resolved_by: string | null;
  slack_thread_url: string | null;
  resolution_note: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserInfo {
  name: string;
  display_name: string;
}

export interface PipelineResponse {
  status: string;
  incident_count: number;
  incidents: IncidentSummary[];
}

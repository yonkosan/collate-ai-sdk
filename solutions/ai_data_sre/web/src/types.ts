export interface IncidentSummary {
  id: string;
  title: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  status: string;
  failure_count: number;
  blast_radius_size: number;
  root_cause_table: string;
  root_cause_column: string | null;
  failing_columns: string[];
  assigned_to: string | null;
  acknowledged_by: string | null;
  resolved_by: string | null;
  slack_thread_url: string | null;
  created_at: string;
  has_report: boolean;
  report_generating: boolean;
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

export interface IncidentEvent {
  action: string;
  actor: string;
  detail: string;
  timestamp: string;
}

export interface NoteAlignment {
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  explanation: string;
}

export interface VerificationResult {
  passed: boolean;
  message: string;
  still_failing_tests: string[];
  verified_at: string;
  note_alignment: NoteAlignment | null;
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
  report_generating: boolean;
  assigned_to: string | null;
  acknowledged_by: string | null;
  resolved_by: string | null;
  slack_thread_url: string | null;
  resolution_note: string | null;
  resolution_category: string | null;
  verification_result: VerificationResult | null;
  events: IncidentEvent[];
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

export interface FixSuggestion {
  test_case_name: string;
  description: string;
  sql: string;
  impact_summary: string;
  risk_level: string;
  rows_affected_estimate: number;
  fix_type: 'data_fix' | 'guardrail';
  fix_target: 'root_cause' | 'symptom';
  test_definition: string;
  entity_link: string;
  parameter_values: { name: string; value: string }[];
}

export interface FixResult {
  success: boolean;
  message: string;
  rows_affected: number;
  executed_sql: string;
  executed_at: string;
}

export interface GuardrailResult {
  success: boolean;
  message: string;
  test_case_name: string;
  test_case_id: string;
  om_link: string;
  created_at: string;
}

export interface RerunResult {
  test_case_name: string;
  status: string;
  message: string;
  timestamp: string;
}

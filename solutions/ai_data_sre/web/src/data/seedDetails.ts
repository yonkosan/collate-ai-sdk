import type { IncidentDetail } from '../types';
import { SEED_REPORTS } from './seedReports';
import { PAST_INCIDENTS } from './seedIncidents';

/**
 * Demo-mode seed data: full IncidentDetail objects for active (live) incidents
 * and historical incidents, so the deployed frontend can show a rich experience
 * without a backend.
 */

/* ── Active incidents (simulates what the pipeline would detect) ────────── */

const DEMO_ACTIVE: IncidentDetail[] = [
  {
    id: 'demo-001',
    title: 'Future-dated order_date in raw_orders',
    severity: 'CRITICAL',
    status: 'reported',
    failures: [
      {
        test_case_id: 'tc-001',
        test_case_name: 'raw_orders_order_date_between',
        table_fqn: 'supply_chain_mysql.supply_chain_analytics.supply_chain.raw_orders',
        column: 'order_date',
        test_definition: 'columnValuesToBeBetween',
        result_message: '847 rows have order_date values beyond 2026-04-27. Max found: 2027-11-15.',
        timestamp: '2026-04-27T08:15:00Z',
        faulty_rows: [
          { row_data: { order_id: '4012', order_date: '2027-03-18', customer_id: '289', quantity: '5' }, reason: 'order_date is in the future' },
          { row_data: { order_id: '4156', order_date: '2027-08-02', customer_id: '512', quantity: '2' }, reason: 'order_date is in the future' },
          { row_data: { order_id: '4389', order_date: '2027-11-15', customer_id: '103', quantity: '8' }, reason: 'order_date is in the future' },
        ],
      },
      {
        test_case_id: 'tc-002',
        test_case_name: 'staging_orders_total_price_positive',
        table_fqn: 'supply_chain_mysql.supply_chain_analytics.supply_chain.staging_orders',
        column: 'total_price',
        test_definition: 'columnValuesToBeBetween',
        result_message: '312 rows have negative total_price, derived from future-dated orders.',
        timestamp: '2026-04-27T08:15:00Z',
        faulty_rows: [
          { row_data: { order_id: '4012', total_price: '-125.50', order_date: '2027-03-18' }, reason: 'Negative total_price from future-dated order' },
        ],
      },
      {
        test_case_id: 'tc-003',
        test_case_name: 'exec_dashboard_daily_revenue_valid',
        table_fqn: 'supply_chain_mysql.supply_chain_analytics.supply_chain.exec_dashboard_kpis',
        column: 'daily_revenue',
        test_definition: 'columnValuesToBeBetween',
        result_message: 'daily_revenue exceeds expected range. Max: $2.3M (expected < $500K).',
        timestamp: '2026-04-27T08:15:00Z',
        faulty_rows: [],
      },
    ],
    failure_histories: [
      {
        test_case_name: 'raw_orders_order_date_between',
        results: [
          { timestamp: '2026-04-27T08:15:00Z', status: 'Failed', result_message: '847 rows beyond range' },
          { timestamp: '2026-04-26T08:15:00Z', status: 'Failed', result_message: '845 rows beyond range' },
          { timestamp: '2026-04-25T08:15:00Z', status: 'Success', result_message: 'All values within range' },
          { timestamp: '2026-04-24T08:15:00Z', status: 'Success', result_message: 'All values within range' },
          { timestamp: '2026-04-23T08:15:00Z', status: 'Success', result_message: 'All values within range' },
        ],
        total_runs: 5,
        failure_count: 2,
        first_failure: '2026-04-26T08:15:00Z',
        is_recurring: true,
      },
    ],
    blast_radius: {
      root_cause_table: 'supply_chain_mysql.supply_chain_analytics.supply_chain.raw_orders',
      root_cause_column: 'order_date',
      upstream_chain: [],
      downstream_impact: [
        { fqn: 'supply_chain_mysql.supply_chain_analytics.supply_chain.staging_orders', entity_type: 'table', display_name: 'staging_orders', description: 'Cleaned order data', owners: ['alice'], tier: 'Tier.Tier2', domain: null, tags: [], depth: 1 },
        { fqn: 'supply_chain_mysql.supply_chain_analytics.supply_chain.fact_order_metrics', entity_type: 'table', display_name: 'fact_order_metrics', description: 'Daily order metrics', owners: ['bob'], tier: 'Tier.Tier1', domain: null, tags: [], depth: 2 },
        { fqn: 'supply_chain_mysql.supply_chain_analytics.supply_chain.exec_dashboard_kpis', entity_type: 'table', display_name: 'exec_dashboard_kpis', description: 'Executive KPI rollups', owners: ['alice', 'bob'], tier: 'Tier.Tier1', domain: null, tags: [], depth: 3 },
      ],
      total_affected_assets: 3,
      affected_owners: ['alice', 'bob'],
    },
    report: {
      summary: 'Critical data quality failure detected in the supply chain pipeline. 847 rows in raw_orders have future-dated order_date values (up to 2027-11-15), causing cascading failures through staging_orders, fact_order_metrics, and exec_dashboard_kpis.',
      root_cause_analysis: 'The raw_orders table contains 847 rows with order_date values ranging from 2025-01-01 to 2027-11-15 — well beyond today\'s date. This is consistent with a source system timezone misconfiguration or a batch job that loaded test/preview data into the production pipeline. The future dates cause downstream pricing calculations to produce negative values and inflate executive KPI metrics.',
      blast_radius_description: 'The corruption propagates through 3 downstream tables: staging_orders (312 negative total_price values), fact_order_metrics (inflated daily revenue), and exec_dashboard_kpis (daily revenue showing $2.3M instead of expected ~$150K). The executive dashboard used by the CEO and CFO is directly impacted.',
      severity_justification: 'CRITICAL — The executive dashboard is showing wildly incorrect revenue figures ($2.3M vs expected $150K). Financial decisions may be made on corrupted data. Multiple teams are affected and the blast radius extends to Tier 1 executive assets.',
      recommendations: [
        'Immediately fix raw_orders by capping order_date to today\'s date: UPDATE raw_orders SET order_date = CURDATE() WHERE order_date > CURDATE()',
        'Add a columnValuesToBeBetween guardrail on raw_orders.order_date with max = CURDATE()',
        'Investigate the source system to determine why future dates are being generated',
        'Add a pre-ingestion validation gate that rejects rows with future dates',
        'Refresh all downstream materialized views after the fix',
      ],
      stakeholders_affected: 'Executive leadership (CEO, CFO), Finance team, Supply chain operations, Data Engineering',
      trend_analysis: 'This is a recurring issue — the failure started yesterday (April 26) and has persisted. The row count increased from 845 to 847, suggesting new future-dated rows are still being ingested.',
      generated_at: '2026-04-27T08:30:00Z',
    },
    report_generating: false,
    assigned_to: null,
    acknowledged_by: null,
    resolved_by: null,
    slack_thread_url: null,
    resolution_note: null,
    resolution_category: null,
    verification_result: null,
    events: [
      { action: 'detected', actor: 'sentinel', detail: '3 DQ test failures detected on raw_orders and downstream tables', timestamp: '2026-04-27T08:15:00Z' },
      { action: 'investigated', actor: 'investigator', detail: 'Root cause: raw_orders.order_date — 847 future-dated rows. Blast radius: 3 downstream assets including exec_dashboard_kpis', timestamp: '2026-04-27T08:20:00Z' },
      { action: 'reported', actor: 'narrator', detail: 'AI incident report generated with root cause analysis and 5 recommendations', timestamp: '2026-04-27T08:30:00Z' },
    ],
    acknowledged_at: null,
    resolved_at: null,
    created_at: '2026-04-27T08:15:00Z',
    updated_at: '2026-04-27T08:30:00Z',
  },
  {
    id: 'demo-002',
    title: 'NULL reliability_score in raw_suppliers',
    severity: 'HIGH',
    status: 'acknowledged',
    failures: [
      {
        test_case_id: 'tc-004',
        test_case_name: 'raw_suppliers_reliability_score_not_null',
        table_fqn: 'supply_chain_mysql.supply_chain_analytics.supply_chain.raw_suppliers',
        column: 'reliability_score',
        test_definition: 'columnValuesToBeNotNull',
        result_message: '3 rows have NULL reliability_score values.',
        timestamp: '2026-04-27T08:15:00Z',
        faulty_rows: [
          { row_data: { supplier_id: '47', supplier_name: 'GlobalTech Parts', reliability_score: 'NULL', region: 'APAC' }, reason: 'NULL reliability_score' },
          { row_data: { supplier_id: '112', supplier_name: 'Nordic Materials', reliability_score: 'NULL', region: 'EMEA' }, reason: 'NULL reliability_score' },
          { row_data: { supplier_id: '203', supplier_name: 'Pacific Metals Co', reliability_score: 'NULL', region: 'APAC' }, reason: 'NULL reliability_score' },
        ],
      },
    ],
    failure_histories: [
      {
        test_case_name: 'raw_suppliers_reliability_score_not_null',
        results: [
          { timestamp: '2026-04-27T08:15:00Z', status: 'Failed', result_message: '3 NULL values' },
          { timestamp: '2026-04-26T08:15:00Z', status: 'Success', result_message: 'No nulls found' },
          { timestamp: '2026-04-25T08:15:00Z', status: 'Success', result_message: 'No nulls found' },
        ],
        total_runs: 3,
        failure_count: 1,
        first_failure: '2026-04-27T08:15:00Z',
        is_recurring: false,
      },
    ],
    blast_radius: {
      root_cause_table: 'supply_chain_mysql.supply_chain_analytics.supply_chain.raw_suppliers',
      root_cause_column: 'reliability_score',
      upstream_chain: [],
      downstream_impact: [
        { fqn: 'supply_chain_mysql.supply_chain_analytics.supply_chain.staging_suppliers', entity_type: 'table', display_name: 'staging_suppliers', description: 'Suppliers with grades', owners: ['bob'], tier: 'Tier.Tier2', domain: null, tags: [], depth: 1 },
        { fqn: 'supply_chain_mysql.supply_chain_analytics.supply_chain.fact_supply_chain', entity_type: 'table', display_name: 'fact_supply_chain', description: 'Supply chain health', owners: ['bob'], tier: 'Tier.Tier1', domain: null, tags: [], depth: 2 },
        { fqn: 'supply_chain_mysql.supply_chain_analytics.supply_chain.exec_dashboard_kpis', entity_type: 'table', display_name: 'exec_dashboard_kpis', description: 'Executive KPIs', owners: ['alice', 'bob'], tier: 'Tier.Tier1', domain: null, tags: [], depth: 3 },
      ],
      total_affected_assets: 3,
      affected_owners: ['alice', 'bob'],
    },
    report: {
      summary: '3 suppliers have NULL reliability_score values in raw_suppliers, causing incorrect supplier grading in staging_suppliers and skewed supply chain health metrics.',
      root_cause_analysis: 'Three new suppliers were onboarded without reliability assessment scores. The source ERP system allows NULL values in the reliability_score field for newly added suppliers, but the downstream pipeline expects non-null values for grade calculations.',
      blast_radius_description: 'Propagates through staging_suppliers (incorrect reliability grades), fact_supply_chain (skewed health metrics), and exec_dashboard_kpis (inaccurate supply chain KPIs). 3 downstream assets affected.',
      severity_justification: 'HIGH — Supply chain health metrics feed into executive decision-making. The NULL scores cause division-by-zero errors in grade calculation, producing misleading supplier ratings.',
      recommendations: [
        'Set a default reliability_score for new suppliers: UPDATE raw_suppliers SET reliability_score = 50.0 WHERE reliability_score IS NULL',
        'Add a columnValuesToBeNotNull guardrail on raw_suppliers.reliability_score',
        'Request the ERP team to make reliability_score mandatory for new supplier entries',
      ],
      stakeholders_affected: 'Supply chain operations (bob), Procurement team, Executive leadership',
      trend_analysis: 'First occurrence. The 3 suppliers were onboarded yesterday.',
      generated_at: '2026-04-27T08:35:00Z',
    },
    report_generating: false,
    assigned_to: 'bob',
    acknowledged_by: 'bob',
    resolved_by: null,
    slack_thread_url: null,
    resolution_note: null,
    resolution_category: null,
    verification_result: null,
    events: [
      { action: 'detected', actor: 'sentinel', detail: '1 DQ test failure on raw_suppliers.reliability_score', timestamp: '2026-04-27T08:15:00Z' },
      { action: 'investigated', actor: 'investigator', detail: 'Root cause: raw_suppliers.reliability_score — 3 NULL values. Blast radius: 3 downstream assets', timestamp: '2026-04-27T08:22:00Z' },
      { action: 'reported', actor: 'narrator', detail: 'AI report generated', timestamp: '2026-04-27T08:35:00Z' },
      { action: 'assigned', actor: 'admin', detail: 'Assigned to bob', timestamp: '2026-04-27T08:40:00Z' },
      { action: 'acknowledged', actor: 'bob', detail: 'Incident acknowledged', timestamp: '2026-04-27T08:42:00Z' },
    ],
    acknowledged_at: '2026-04-27T08:42:00Z',
    resolved_at: null,
    created_at: '2026-04-27T08:15:00Z',
    updated_at: '2026-04-27T08:42:00Z',
  },
  {
    id: 'demo-003',
    title: 'Negative cost_price in raw_products',
    severity: 'MEDIUM',
    status: 'reported',
    failures: [
      {
        test_case_id: 'tc-005',
        test_case_name: 'raw_products_cost_price_positive',
        table_fqn: 'supply_chain_mysql.supply_chain_analytics.supply_chain.raw_products',
        column: 'cost_price',
        test_definition: 'columnValuesToBeBetween',
        result_message: '5 rows have negative cost_price values. Min found: -$42.99.',
        timestamp: '2026-04-27T08:15:00Z',
        faulty_rows: [
          { row_data: { product_id: '1847', product_name: 'Titanium Bolt M8', cost_price: '-12.50', category: 'fasteners' }, reason: 'Negative cost_price' },
          { row_data: { product_id: '1923', product_name: 'Steel Washer Kit', cost_price: '-42.99', category: 'fasteners' }, reason: 'Negative cost_price' },
          { row_data: { product_id: '2011', product_name: 'Copper Wire 2mm', cost_price: '-0.01', category: 'electrical' }, reason: 'Negative cost_price' },
        ],
      },
    ],
    failure_histories: [
      {
        test_case_name: 'raw_products_cost_price_positive',
        results: [
          { timestamp: '2026-04-27T08:15:00Z', status: 'Failed', result_message: '5 negative values' },
          { timestamp: '2026-04-26T08:15:00Z', status: 'Success', result_message: 'All values positive' },
          { timestamp: '2026-04-25T08:15:00Z', status: 'Success', result_message: 'All values positive' },
          { timestamp: '2026-04-24T08:15:00Z', status: 'Success', result_message: 'All values positive' },
        ],
        total_runs: 4,
        failure_count: 1,
        first_failure: '2026-04-27T08:15:00Z',
        is_recurring: false,
      },
    ],
    blast_radius: {
      root_cause_table: 'supply_chain_mysql.supply_chain_analytics.supply_chain.raw_products',
      root_cause_column: 'cost_price',
      upstream_chain: [],
      downstream_impact: [
        { fqn: 'supply_chain_mysql.supply_chain_analytics.supply_chain.staging_products', entity_type: 'table', display_name: 'staging_products', description: 'Products with margins', owners: ['admin'], tier: 'Tier.Tier2', domain: null, tags: [], depth: 1 },
        { fqn: 'supply_chain_mysql.supply_chain_analytics.supply_chain.fact_order_metrics', entity_type: 'table', display_name: 'fact_order_metrics', description: 'Daily order metrics', owners: ['bob'], tier: 'Tier.Tier1', domain: null, tags: [], depth: 2 },
      ],
      total_affected_assets: 2,
      affected_owners: ['admin', 'bob'],
    },
    report: {
      summary: '5 products in raw_products have negative cost_price values, causing incorrect margin calculations in staging_products and skewed order metrics.',
      root_cause_analysis: 'A data entry error in the source ERP during a bulk product update. The supplier portal allowed negative values in the cost_price field. These 5 products were part of a batch uploaded by the procurement team yesterday.',
      blast_radius_description: 'Affects staging_products (incorrect profit margins for 5 products) and fact_order_metrics (slightly skewed daily metrics). 2 downstream assets impacted.',
      severity_justification: 'MEDIUM — Limited to product cost analytics. 5 products out of 2,100 affected. No executive dashboard impact, but margin calculations are wrong for affected products.',
      recommendations: [
        'Fix the negative prices: UPDATE raw_products SET cost_price = ABS(cost_price) WHERE cost_price < 0',
        'Add a columnValuesToBeBetween guardrail on raw_products.cost_price with min=0',
        'Request ERP team to add frontend validation for price fields',
      ],
      stakeholders_affected: 'Procurement team, Data Engineering (admin)',
      trend_analysis: 'First occurrence. The bulk update feature was recently added to the ERP.',
      generated_at: '2026-04-27T08:33:00Z',
    },
    report_generating: false,
    assigned_to: null,
    acknowledged_by: null,
    resolved_by: null,
    slack_thread_url: null,
    resolution_note: null,
    resolution_category: null,
    verification_result: null,
    events: [
      { action: 'detected', actor: 'sentinel', detail: '1 DQ test failure on raw_products.cost_price', timestamp: '2026-04-27T08:15:00Z' },
      { action: 'investigated', actor: 'investigator', detail: 'Root cause: raw_products.cost_price — 5 negative values. Blast radius: 2 downstream assets', timestamp: '2026-04-27T08:25:00Z' },
      { action: 'reported', actor: 'narrator', detail: 'AI report generated', timestamp: '2026-04-27T08:33:00Z' },
    ],
    acknowledged_at: null,
    resolved_at: null,
    created_at: '2026-04-27T08:15:00Z',
    updated_at: '2026-04-27T08:33:00Z',
  },
];

/* ── IncidentSummary versions of the active incidents ──────────────────── */

export const DEMO_ACTIVE_SUMMARIES = DEMO_ACTIVE.map((d): import('../types').IncidentSummary => ({
  id: d.id,
  title: d.title,
  severity: d.severity,
  status: d.status,
  failure_count: d.failures.length,
  blast_radius_size: d.blast_radius?.total_affected_assets ?? 0,
  root_cause_table: d.blast_radius?.root_cause_table ?? '',
  root_cause_column: d.blast_radius?.root_cause_column ?? null,
  failing_columns: d.failures.map((f) => f.column).filter((c): c is string => c !== null),
  assigned_to: d.assigned_to,
  acknowledged_by: d.acknowledged_by,
  resolved_by: d.resolved_by,
  slack_thread_url: d.slack_thread_url,
  created_at: d.created_at,
  has_report: d.report !== null,
  report_generating: d.report_generating,
  has_recurring_failures: d.failure_histories.some((h) => h.is_recurring),
}));

/* ── Historical incident details (from seed reports) ──────────────────── */

function buildHistDetail(inc: import('../types').IncidentSummary): IncidentDetail {
  const seed = SEED_REPORTS[inc.id];
  return {
    id: inc.id,
    title: inc.title,
    severity: inc.severity,
    status: inc.status,
    failures: [],
    failure_histories: [],
    blast_radius: null,
    report: seed?.report ?? null,
    report_generating: false,
    assigned_to: seed?.assigned_to ?? inc.assigned_to,
    acknowledged_by: inc.acknowledged_by,
    resolved_by: seed?.resolved_by ?? inc.resolved_by,
    slack_thread_url: null,
    resolution_note: seed?.resolution_note ?? null,
    resolution_category: seed?.resolution_category ?? null,
    verification_result: null,
    events: [
      { action: 'detected', actor: 'sentinel', detail: `${inc.failure_count} DQ failures detected`, timestamp: inc.created_at },
      { action: 'resolved', actor: seed?.resolved_by ?? 'admin', detail: seed?.resolution_note ?? 'Resolved', timestamp: seed?.resolved_at ?? inc.created_at },
    ],
    acknowledged_at: inc.created_at,
    resolved_at: seed?.resolved_at ?? null,
    created_at: inc.created_at,
    updated_at: seed?.resolved_at ?? inc.created_at,
  };
}

/* ── Lookup map for demo mode ──────────────────────────────────────────── */

const detailMap = new Map<string, IncidentDetail>();
for (const d of DEMO_ACTIVE) {
  detailMap.set(d.id, d);
}
for (const inc of PAST_INCIDENTS) {
  detailMap.set(inc.id, buildHistDetail(inc));
}

export function getDemoDetail(id: string): IncidentDetail | null {
  return detailMap.get(id) ?? null;
}

export { DEMO_ACTIVE };

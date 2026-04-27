import type { IncidentReport } from '../types';

/**
 * Seed AI reports for historical (seed) incidents.
 * Keyed by incident id from seedIncidents.ts.
 */

interface SeedReportEntry {
  report: IncidentReport;
  assigned_to: string;
  resolved_by: string;
  severity: string;
  resolution_note: string;
  resolution_category: string;
  resolved_at: string;
}

export const SEED_REPORTS: Record<string, SeedReportEntry> = {
  'hist-001': {
    report: {
      summary:
        'Multiple NULL values detected in the customer_email column of staging_customers. 147 rows out of 12,340 had missing email addresses, causing downstream CRM sync failures and incomplete customer segmentation.',
      root_cause_analysis:
        'A schema change in the upstream raw_customers source removed the NOT NULL constraint on email. The ETL pipeline did not validate for nulls, allowing bad rows to propagate into staging.',
      blast_radius_description:
        'Affects staging_customers → dim_customers → customer_segmentation → marketing_dashboard. 5 downstream assets impacted, including the executive marketing dashboard used by the CMO.',
      severity_justification:
        'HIGH — Direct impact on customer-facing marketing campaigns and CRM sync. 147 customers temporarily invisible to marketing automation.',
      recommendations: [
        'Add a columnValuesToBeNotNull test on staging_customers.customer_email',
        'Add input validation in the ETL pipeline to reject rows with NULL email',
        'Set up an alert for schema changes on raw_customers',
      ],
      stakeholders_affected: 'Marketing team, CRM ops (alice), Data Engineering',
      trend_analysis:
        'First occurrence. No prior failures on this column. The schema change was deployed 2 hours before detection.',
      generated_at: '2026-04-20T09:45:00Z',
    },
    assigned_to: 'alice',
    resolved_by: 'alice',
    severity: 'HIGH',
    resolution_note: 'Restored NOT NULL constraint on raw_customers.email and backfilled 147 missing emails from CRM export.',
    resolution_category: 'schema_change',
    resolved_at: '2026-04-20T11:30:00Z',
  },
  'hist-002': {
    report: {
      summary:
        'Duplicate order_id values detected in raw_orders. 23 duplicate pairs found, causing inflated revenue calculations in the executive dashboard and incorrect order counts in the supply chain report.',
      root_cause_analysis:
        'The ingestion pipeline was re-run after a partial failure without deduplication. The upsert logic used APPEND mode instead of UPSERT, resulting in duplicate rows for orders processed during the retry window.',
      blast_radius_description:
        'Affects raw_orders → staging_orders → fact_orders → exec_dashboard_kpis → supply_chain_report → 3 BI dashboards. 8 total downstream assets impacted.',
      severity_justification:
        'CRITICAL — Executive dashboard showed inflated revenue ($45K overstated). Supply chain planning decisions were being made on incorrect data.',
      recommendations: [
        'Switch ingestion mode from APPEND to UPSERT with order_id as the dedup key',
        'Add a columnValuesToBeUnique test on raw_orders.order_id',
        'Implement idempotent pipeline runs with checkpointing',
      ],
      stakeholders_affected: 'Finance team, Supply chain ops (bob), Executive leadership',
      trend_analysis:
        'Recurring issue — similar duplicates were seen 3 weeks ago after a pipeline retry. Root cause was the same: missing deduplication on retry.',
      generated_at: '2026-04-18T15:00:00Z',
    },
    assigned_to: 'bob',
    resolved_by: 'bob',
    severity: 'CRITICAL',
    resolution_note: 'Removed 23 duplicate order rows and switched pipeline to UPSERT mode. Added unique constraint on order_id.',
    resolution_category: 'pipeline_bug',
    resolved_at: '2026-04-18T17:15:00Z',
  },
  'hist-003': {
    report: {
      summary:
        'Negative unit_price values detected in raw_products. 5 products had prices ranging from -$12.50 to -$0.01, causing incorrect cost calculations in the procurement dashboard.',
      root_cause_analysis:
        'A data entry error in the source ERP system. The supplier portal allowed negative values in the price field during a bulk update. No validation existed in the ingestion pipeline.',
      blast_radius_description:
        'Affects raw_products → staging_products → dim_products → procurement_analysis. 3 downstream assets impacted.',
      severity_justification:
        'MEDIUM — Limited to procurement analytics. No customer-facing impact. 5 products out of 2,100 affected.',
      recommendations: [
        'Add a columnValuesToBeBetween test on raw_products.unit_price (min=0)',
        'Request ERP team to add frontend validation on price fields',
        'Add a data quality check at ingestion time to reject negative prices',
      ],
      stakeholders_affected: 'Procurement team, Data Engineering (admin)',
      trend_analysis:
        'First occurrence. The bulk update feature was newly added to the ERP.',
      generated_at: '2026-04-15T12:15:00Z',
    },
    assigned_to: 'admin',
    resolved_by: 'admin',
    severity: 'MEDIUM',
    resolution_note: 'Corrected 5 negative prices in raw_products using ERP source data. Added min-value validation.',
    resolution_category: 'data_issue',
    resolved_at: '2026-04-15T14:00:00Z',
  },
  'hist-004': {
    report: {
      summary:
        'Schema drift detected in exec_dashboard_kpis. The revenue and order_count columns changed data types from DECIMAL to VARCHAR after a dbt model refactor, breaking downstream BI dashboards.',
      root_cause_analysis:
        'A dbt model was refactored to use a CTE that inadvertently cast numeric columns to strings. The change passed CI because type tests were not in place.',
      blast_radius_description:
        'Affects exec_dashboard_kpis → 2 Tableau dashboards. 2 downstream assets impacted, including the CEO daily KPI dashboard.',
      severity_justification:
        'HIGH — CEO dashboard was showing errors for 4 hours. Executive visibility into daily revenue was completely blocked.',
      recommendations: [
        'Add column type tests in dbt for critical KPI tables',
        'Require data quality checks in dbt CI before merge',
        'Add monitoring alerts for schema changes on executive tables',
      ],
      stakeholders_affected: 'Executive leadership, BI team (alice)',
      trend_analysis:
        'First occurrence. Schema tests were not part of the dbt CI pipeline.',
      generated_at: '2026-04-12T16:50:00Z',
    },
    assigned_to: 'alice',
    resolved_by: 'alice',
    severity: 'HIGH',
    resolution_note: 'Reverted dbt model to use explicit CAST for revenue and order_count. Added schema tests to CI.',
    resolution_category: 'config_error',
    resolved_at: '2026-04-12T18:30:00Z',
  },
  'hist-005': {
    report: {
      summary:
        'Future-dated ship_date values detected in staging_orders. 12 orders had ship dates in 2027, causing incorrect shipping SLA calculations and misleading the logistics dashboard.',
      root_cause_analysis:
        'The source system used a 2-digit year format that was incorrectly parsed. Orders with ship year "27" were interpreted as 2027 instead of being flagged as invalid.',
      blast_radius_description:
        'Affects staging_orders → fact_orders → shipping_sla_report → logistics_dashboard. 4 downstream assets impacted.',
      severity_justification:
        'MEDIUM — Limited to shipping analytics. No financial impact. 12 orders out of 8,500 affected.',
      recommendations: [
        'Add a custom SQL test to ensure ship_date <= CURDATE()',
        'Fix the date parsing logic to validate year ranges',
        'Add a pre-ingestion data quality gate for date columns',
      ],
      stakeholders_affected: 'Logistics team, Data Engineering (bob)',
      trend_analysis:
        'Recurring — similar future-date issues were seen with order_date 2 months ago. Root cause is the same date parsing logic.',
      generated_at: '2026-04-10T08:30:00Z',
    },
    assigned_to: 'bob',
    resolved_by: 'bob',
    severity: 'MEDIUM',
    resolution_note: 'Fixed date parsing to use 4-digit year format. Corrected 12 future-dated ship_date values.',
    resolution_category: 'pipeline_bug',
    resolved_at: '2026-04-10T10:45:00Z',
  },
};

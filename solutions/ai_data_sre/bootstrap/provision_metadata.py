# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""Register the supply-chain database in OpenMetadata and trigger ingestion.

This script:
  1. Creates a MySQL database service pointing to openmetadata_mysql
  2. Creates and deploys a metadata ingestion pipeline via Airflow
  3. Triggers ingestion and waits for completion
  4. Creates column-level lineage edges (ETL logic not auto-discovered)
  5. Creates data quality test cases on critical columns
  6. Seeds test results so the Sentinel has failures to detect

Prerequisites:
  - OpenMetadata dev container running (localhost:8585)
  - MySQL provisioned via: python -m bootstrap.provision_mysql

Usage:
    cd solutions/ai_data_sre
    python -m bootstrap.provision_metadata
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx
from rich.console import Console
from rich.table import Table as RichTable

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.config import DataPulseConfig

console = Console()

# ─── Constants ──────────────────────────────────────────────────────────────────

SERVICE_NAME = "DataPulse_SupplyChain"
DATABASE_NAME = "supply_chain_analytics"
INGESTION_PIPELINE_NAME = f"{SERVICE_NAME}_metadata_ingestion"
DOMAIN_NAME = "Supply Chain"
GLOSSARY_NAME = "SupplyChainGlossary"

INGESTION_POLL_INTERVAL = 5  # seconds
INGESTION_TIMEOUT = 180  # seconds

TABLE_NAMES = [
    "raw_orders",
    "raw_products",
    "raw_suppliers",
    "staging_orders",
    "staging_suppliers",
    "fact_order_metrics",
    "fact_supply_chain",
    "exec_dashboard_kpis",
]

# ─── Rich Metadata ──────────────────────────────────────────────────────────

TABLE_DESCRIPTIONS: dict[str, str] = {
    "raw_orders": (
        "Raw customer orders ingested daily from the ERP system. "
        "Contains order date, quantity, unit price, and fulfillment status. "
        "**Source of truth** for all order analytics."
    ),
    "raw_products": (
        "Product catalog from the master data system. "
        "Includes SKU, category, supplier mapping, and cost pricing."
    ),
    "raw_suppliers": (
        "Supplier directory with performance metrics. "
        "Tracks country of origin, lead time, and reliability scores."
    ),
    "staging_orders": (
        "Enriched order data — joins raw_orders with raw_products. "
        "Computes total_price = quantity × unit_price. "
        "**Business rule**: future-dated orders should not have negative prices."
    ),
    "staging_suppliers": (
        "Cleansed supplier records passed through from raw_suppliers. "
        "Applied data standardization and deduplication."
    ),
    "fact_order_metrics": (
        "Daily aggregated order metrics. "
        "Computes total_orders, total_revenue, avg_order_value per day. "
        "Feeds the executive KPI dashboard."
    ),
    "fact_supply_chain": (
        "Supplier performance fact table. "
        "Calculates reliability grades (A-D) and product supply counts."
    ),
    "exec_dashboard_kpis": (
        "**Tier 1 — Executive KPI Dashboard**. "
        "Combines order metrics and supply chain data for C-suite reporting. "
        "daily_revenue, order_volume, supply_risk_score. "
        "SLA: data must be accurate within 1 hour of source update."
    ),
}

# Tier: 1 = most critical (exec-facing), 3 = raw/source
TABLE_TIERS: dict[str, str] = {
    "raw_orders": "Tier.Tier3",
    "raw_products": "Tier.Tier3",
    "raw_suppliers": "Tier.Tier3",
    "staging_orders": "Tier.Tier2",
    "staging_suppliers": "Tier.Tier2",
    "fact_order_metrics": "Tier.Tier2",
    "fact_supply_chain": "Tier.Tier2",
    "exec_dashboard_kpis": "Tier.Tier1",
}

# Glossary terms to create and link
GLOSSARY_TERMS: list[dict] = [
    {
        "name": "Daily Revenue",
        "description": "Total revenue aggregated per calendar day from completed orders. "
                       "Calculated as SUM(quantity * unit_price) grouped by order_date.",
        "link_to": [("exec_dashboard_kpis", "daily_revenue"), ("fact_order_metrics", "total_revenue")],
    },
    {
        "name": "Order Volume",
        "description": "Count of distinct orders placed per day. "
                       "Includes all statuses (completed, pending, shipped, cancelled, returned).",
        "link_to": [("exec_dashboard_kpis", "order_volume"), ("fact_order_metrics", "total_orders")],
    },
    {
        "name": "Supply Risk Score",
        "description": "Composite risk metric derived from supplier reliability grades and lead times. "
                       "Scale: 0 (no risk) to 100 (critical supply chain risk).",
        "link_to": [("exec_dashboard_kpis", "supply_risk_score")],
    },
    {
        "name": "Supplier Reliability",
        "description": "Performance score (0.0 – 1.0) measuring on-time delivery rate and defect rate. "
                       "Graded: A (≥0.9), B (≥0.8), C (≥0.7), D (<0.7).",
        "link_to": [("raw_suppliers", "reliability_score"), ("fact_supply_chain", "reliability_grade")],
    },
]

# Column descriptions for key columns
COLUMN_DESCRIPTIONS: dict[str, dict[str, str]] = {
    "raw_orders": {
        "order_id": "Unique order identifier from the ERP system.",
        "customer_id": "Anonymized customer identifier. PII — do not expose in public dashboards.",
        "order_date": "Date the order was placed. Must not contain future dates.",
        "quantity": "Number of units ordered. Must be positive.",
        "unit_price": "Price per unit at time of order in USD.",
    },
    "staging_orders": {
        "total_price": "Computed: quantity × unit_price. Must be non-negative for valid orders.",
    },
    "exec_dashboard_kpis": {
        "daily_revenue": "Aggregated daily revenue from all orders. Business-critical KPI.",
        "order_volume": "Total orders per day. Monitored for anomalous drops.",
        "supply_risk_score": "Weighted supply chain risk. Alerts trigger above 75.",
    },
}

# PII columns
PII_COLUMNS: list[tuple[str, str]] = [
    ("raw_orders", "customer_id"),
    ("staging_orders", "customer_id"),
]

# Teams to create for ownership
TEAMS_TO_CREATE: list[dict] = [
    {
        "name": "data-engineering",
        "displayName": "Data Engineering",
        "description": "Owns data ingestion pipelines and raw data layers.",
        "teamType": "Group",
    },
    {
        "name": "analytics-engineering",
        "displayName": "Analytics Engineering",
        "description": "Owns staging and fact table transformations.",
        "teamType": "Group",
    },
    {
        "name": "executive-analytics",
        "displayName": "Executive Analytics",
        "description": "Owns C-suite dashboards and KPI reporting.",
        "teamType": "Group",
    },
]

# Table → owner team mapping
TABLE_OWNERS: dict[str, str] = {
    "raw_orders": "data-engineering",
    "raw_products": "data-engineering",
    "raw_suppliers": "data-engineering",
    "staging_orders": "analytics-engineering",
    "staging_suppliers": "analytics-engineering",
    "fact_order_metrics": "analytics-engineering",
    "fact_supply_chain": "analytics-engineering",
    "exec_dashboard_kpis": "executive-analytics",
}

# Lineage edges representing ETL transformations (not auto-discoverable from MySQL)
LINEAGE_EDGES: list[dict] = [
    {
        "from": "raw_orders",
        "to": "staging_orders",
        "column_mappings": [
            ("order_id", "order_id"),
            ("customer_id", "customer_id"),
            ("order_date", "order_date"),
            ("quantity", "quantity"),
            ("status", "status"),
        ],
    },
    {
        "from": "raw_products",
        "to": "staging_orders",
        "column_mappings": [
            ("product_name", "product_name"),
            ("category", "category"),
        ],
    },
    {
        "from": "raw_suppliers",
        "to": "staging_suppliers",
        "column_mappings": [
            ("supplier_id", "supplier_id"),
            ("supplier_name", "supplier_name"),
            ("country", "country"),
            ("lead_time_days", "lead_time_days"),
            ("reliability_score", "reliability_score"),
        ],
    },
    {
        "from": "staging_orders",
        "to": "fact_order_metrics",
        "column_mappings": [
            ("order_date", "metric_date"),
            ("total_price", "total_revenue"),
            ("category", "top_category"),
        ],
    },
    {
        "from": "staging_suppliers",
        "to": "fact_supply_chain",
        "column_mappings": [
            ("supplier_id", "supplier_id"),
            ("supplier_name", "supplier_name"),
            ("lead_time_days", "avg_lead_time"),
            ("reliability_score", "reliability_grade"),
        ],
    },
    {
        "from": "fact_order_metrics",
        "to": "exec_dashboard_kpis",
        "column_mappings": [
            ("metric_date", "kpi_date"),
            ("total_revenue", "daily_revenue"),
            ("total_orders", "order_volume"),
        ],
    },
    {
        "from": "fact_supply_chain",
        "to": "exec_dashboard_kpis",
        "column_mappings": [
            ("reliability_grade", "supply_risk_score"),
            ("supplier_name", "top_supplier"),
        ],
    },
]

# DQ Test definitions and expected results
TEST_CASES: list[dict] = [
    {
        "name": "raw_orders_date_not_in_future",
        "table": "raw_orders",
        "column": "order_date",
        "testDefinition": "columnValuesToBeBetween",
        "params": [
            {"name": "minValue", "value": "2020-01-01"},
            {"name": "maxValue", "value": "2026-04-24"},
        ],
        "should_fail": True,
        "fail_message": (
            "Found 847 rows with order_date in the future (max: 2027-11-15). "
            "Expected all values between 2020-01-01 and 2026-04-24."
        ),
    },
    {
        "name": "raw_orders_quantity_not_null",
        "table": "raw_orders",
        "column": "quantity",
        "testDefinition": "columnValuesToBeNotNull",
        "params": [],
        "should_fail": False,
        "fail_message": "",
    },
    {
        "name": "staging_orders_total_price_positive",
        "table": "staging_orders",
        "column": "total_price",
        "testDefinition": "columnValuesToBeBetween",
        "params": [
            {"name": "minValue", "value": "0"},
        ],
        "should_fail": True,
        "fail_message": (
            "Found 847 rows with negative total_price (min: -4250.00). "
            "Caused by upstream raw_orders.order_date containing future dates "
            "that bypass date-based pricing logic."
        ),
    },
    {
        "name": "fact_order_metrics_revenue_not_null",
        "table": "fact_order_metrics",
        "column": "total_revenue",
        "testDefinition": "columnValuesToBeNotNull",
        "params": [],
        "should_fail": False,
        "fail_message": "",
    },
    {
        "name": "exec_kpis_revenue_reasonable",
        "table": "exec_dashboard_kpis",
        "column": "daily_revenue",
        "testDefinition": "columnValuesToBeBetween",
        "params": [
            {"name": "minValue", "value": "0"},
            {"name": "maxValue", "value": "10000000"},
        ],
        "should_fail": True,
        "fail_message": (
            "Found rows with daily_revenue outside expected range "
            "(negative values from corrupted upstream data). "
            "Root cause: raw_orders.order_date contains future dates."
        ),
    },
]


class MetadataProvisioner:
    """Registers the supply-chain DB in OpenMetadata and configures DQ."""

    def __init__(self, config: DataPulseConfig) -> None:
        self._config = config
        self._client = httpx.Client(
            base_url=config.openmetadata_host,
            headers=config.api_headers,
            timeout=60.0,
        )
        self._service_id: str = ""
        self._table_ids: dict[str, str] = {}
        self._table_fqns: dict[str, str] = {}

    def close(self) -> None:
        self._client.close()

    # ── Public API ──────────────────────────────────────────────────────────

    def provision_all(self) -> None:
        console.rule("[bold cyan]DataPulse — OpenMetadata Provisioner")
        self._create_teams()
        self._create_domain()
        self._create_service()
        self._create_database_and_schema()
        self._create_tables_directly()
        self._discover_tables()
        self._enrich_tables()
        self._create_glossary()
        self._create_lineage()
        self._push_sample_data()
        self._push_table_profiles()
        self._create_test_cases()
        self._seed_test_result_history()
        self._print_summary()
        console.rule("[bold green]Provisioning complete!")

    # ── Step 0a: Create teams ────────────────────────────────────────────

    def _create_teams(self) -> None:
        console.print("\n[bold]0a/12[/] Creating ownership teams…")
        for team in TEAMS_TO_CREATE:
            payload = {
                "name": team["name"],
                "displayName": team["displayName"],
                "description": team["description"],
                "teamType": team["teamType"],
            }
            resp = self._client.put("/api/v1/teams", json=payload)
            if resp.status_code < 400:
                console.print(f"  ✓ Team [green]{team['displayName']}[/]")
            else:
                console.print(f"  [yellow]⚠ {team['name']}: {resp.status_code}[/]")

    # ── Step 0b: Create domain ──────────────────────────────────────────────

    def _create_domain(self) -> None:
        console.print("\n[bold]0b/12[/] Creating business domain…")
        payload = {
            "name": DOMAIN_NAME.replace(" ", "-").lower(),
            "displayName": DOMAIN_NAME,
            "description": (
                "Supply Chain Analytics domain encompassing order management, "
                "supplier performance, and executive KPI reporting."
            ),
            "domainType": "Aggregate",
        }
        resp = self._client.put("/api/v1/domains", json=payload)
        if resp.status_code < 400:
            self._domain_fqn = resp.json().get("fullyQualifiedName", "")
            console.print(f"  ✓ Domain [green]{DOMAIN_NAME}[/]")
        else:
            self._domain_fqn = ""
            console.print(f"  [yellow]⚠ Domain: {resp.status_code}[/]")

    # ── Step 1: Create MySQL service ────────────────────────────────────────

    def _create_service(self) -> None:
        console.print("\n[bold]1/12[/] Creating MySQL database service…")
        mysql = self._config.mysql
        payload = {
            "name": SERVICE_NAME,
            "displayName": "DataPulse Supply Chain",
            "serviceType": "Mysql",
            "description": (
                "DataPulse demo — supply chain analytics pipeline. "
                "Connected to the openmetadata_mysql container."
            ),
            "connection": {
                "config": {
                    "type": "Mysql",
                    "scheme": "mysql+pymysql",
                    "username": mysql.user,
                    "authType": {"password": mysql.password},
                    "hostPort": f"{mysql.host_for_ingestion}:{mysql.port}",
                    "databaseName": mysql.database,
                    "supportsMetadataExtraction": True,
                    "supportsProfiler": True,
                }
            },
        }
        resp = self._put("/api/v1/services/databaseServices", payload)
        self._service_id = resp["id"]
        console.print(
            f"  ✓ Service [green]{SERVICE_NAME}[/] ready "
            f"(id: {self._service_id[:8]}…, host: {mysql.host_for_ingestion}:{mysql.port})"
        )

    # ── Step 2: Create database entity ────────────────────────────────────

    def _create_database_and_schema(self) -> None:
        console.print("\n[bold]2/12[/] Creating database & schema entities…")

        # Create database entity
        db_payload = {
            "name": DATABASE_NAME,
            "displayName": "Supply Chain Analytics",
            "service": SERVICE_NAME,
        }
        resp = self._client.put("/api/v1/databases", json=db_payload)
        if resp.status_code < 400:
            self._database_id = resp.json()["id"]
            console.print(f"  ✓ Database [green]{DATABASE_NAME}[/]")
        else:
            console.print(f"  [yellow]⚠ Database: {resp.status_code} {resp.text[:100]}[/]")

        # Create schema entity (MySQL uses database name as default schema)
        db_fqn = f"{SERVICE_NAME}.{DATABASE_NAME}"
        schema_payload = {
            "name": DATABASE_NAME,
            "displayName": "Supply Chain Analytics Schema",
            "database": db_fqn,
        }
        resp = self._client.put("/api/v1/databaseSchemas", json=schema_payload)
        if resp.status_code < 400:
            console.print(f"  ✓ Schema [green]{DATABASE_NAME}[/]")
        else:
            console.print(f"  [yellow]⚠ Schema: {resp.status_code} {resp.text[:100]}[/]")

    # ── Step 2b: Create table entities directly ────────────────────────────

    _MYSQL_TO_OM_TYPE = {
        "INT": "INT",
        "VARCHAR": "VARCHAR",
        "DATE": "DATE",
        "DECIMAL": "DECIMAL",
    }

    TABLE_SCHEMAS: dict[str, list[dict]] = {
        "raw_suppliers": [
            {"name": "supplier_id", "dataType": "INT", "constraint": "PRIMARY_KEY"},
            {"name": "supplier_name", "dataType": "VARCHAR", "dataLength": 200},
            {"name": "country", "dataType": "VARCHAR", "dataLength": 100},
            {"name": "lead_time_days", "dataType": "INT"},
            {"name": "reliability_score", "dataType": "DECIMAL"},
        ],
        "raw_products": [
            {"name": "product_id", "dataType": "INT", "constraint": "PRIMARY_KEY"},
            {"name": "product_name", "dataType": "VARCHAR", "dataLength": 200},
            {"name": "category", "dataType": "VARCHAR", "dataLength": 100},
            {"name": "supplier_id", "dataType": "INT"},
            {"name": "cost_price", "dataType": "DECIMAL"},
            {"name": "sku", "dataType": "VARCHAR", "dataLength": 50},
        ],
        "raw_orders": [
            {"name": "order_id", "dataType": "INT", "constraint": "PRIMARY_KEY"},
            {"name": "customer_id", "dataType": "INT"},
            {"name": "product_id", "dataType": "INT"},
            {"name": "order_date", "dataType": "DATE"},
            {"name": "quantity", "dataType": "INT"},
            {"name": "unit_price", "dataType": "DECIMAL"},
            {"name": "status", "dataType": "VARCHAR", "dataLength": 50},
        ],
        "staging_orders": [
            {"name": "order_id", "dataType": "INT", "constraint": "PRIMARY_KEY"},
            {"name": "customer_id", "dataType": "INT"},
            {"name": "product_name", "dataType": "VARCHAR", "dataLength": 200},
            {"name": "category", "dataType": "VARCHAR", "dataLength": 100},
            {"name": "order_date", "dataType": "DATE"},
            {"name": "quantity", "dataType": "INT"},
            {"name": "total_price", "dataType": "DECIMAL"},
            {"name": "status", "dataType": "VARCHAR", "dataLength": 50},
        ],
        "staging_suppliers": [
            {"name": "supplier_id", "dataType": "INT", "constraint": "PRIMARY_KEY"},
            {"name": "supplier_name", "dataType": "VARCHAR", "dataLength": 200},
            {"name": "country", "dataType": "VARCHAR", "dataLength": 100},
            {"name": "lead_time_days", "dataType": "INT"},
            {"name": "reliability_score", "dataType": "DECIMAL"},
        ],
        "fact_order_metrics": [
            {"name": "metric_date", "dataType": "DATE", "constraint": "PRIMARY_KEY"},
            {"name": "total_orders", "dataType": "INT"},
            {"name": "total_revenue", "dataType": "DECIMAL"},
            {"name": "avg_order_value", "dataType": "DECIMAL"},
            {"name": "top_category", "dataType": "VARCHAR", "dataLength": 100},
        ],
        "fact_supply_chain": [
            {"name": "supplier_id", "dataType": "INT", "constraint": "PRIMARY_KEY"},
            {"name": "supplier_name", "dataType": "VARCHAR", "dataLength": 200},
            {"name": "avg_lead_time", "dataType": "DECIMAL"},
            {"name": "reliability_grade", "dataType": "VARCHAR", "dataLength": 1},
            {"name": "total_products_supplied", "dataType": "INT"},
        ],
        "exec_dashboard_kpis": [
            {"name": "kpi_date", "dataType": "DATE", "constraint": "PRIMARY_KEY"},
            {"name": "daily_revenue", "dataType": "DECIMAL"},
            {"name": "order_volume", "dataType": "INT"},
            {"name": "supply_risk_score", "dataType": "DECIMAL"},
            {"name": "top_supplier", "dataType": "VARCHAR", "dataLength": 200},
        ],
    }

    def _create_tables_directly(self) -> None:
        console.print("[bold]3/12[/] Creating table entities via REST API…")
        schema_fqn = f"{SERVICE_NAME}.{DATABASE_NAME}.{DATABASE_NAME}"

        for table_name in TABLE_NAMES:
            columns = self.TABLE_SCHEMAS[table_name]
            # Enrich columns with descriptions
            col_descs = COLUMN_DESCRIPTIONS.get(table_name, {})
            for col in columns:
                if col["name"] in col_descs:
                    col["description"] = col_descs[col["name"]]

            payload = {
                "name": table_name,
                "displayName": table_name.replace("_", " ").title(),
                "description": TABLE_DESCRIPTIONS.get(table_name, ""),
                "databaseSchema": schema_fqn,
                "tableType": "Regular",
                "columns": columns,
            }
            resp = self._client.put("/api/v1/tables", json=payload)
            if resp.status_code < 400:
                data = resp.json()
                self._table_ids[table_name] = data["id"]
                self._table_fqns[table_name] = data["fullyQualifiedName"]
                console.print(f"  ✓ [green]{data['fullyQualifiedName']}[/]")
            else:
                console.print(
                    f"  [red]✗ {table_name}: {resp.status_code} {resp.text[:150]}[/]"
                )

    # ── Step 3: Discover ingested tables ────────────────────────────────────

    def _discover_tables(self) -> None:
        """Verify tables exist (they were already created in step 3)."""
        if len(self._table_ids) == len(TABLE_NAMES):
            return  # All tables already populated from _create_tables_directly

        for table_name in TABLE_NAMES:
            # MySQL ingestion uses: service.database.schema.table
            # The default schema for MySQL is the database name itself
            fqn = f"{SERVICE_NAME}.{DATABASE_NAME}.{DATABASE_NAME}.{table_name}"
            resp = self._client.get(f"/api/v1/tables/name/{fqn}")

            if resp.status_code == 404:
                # Fallback: might not have doubled database name
                alt_fqn = f"{SERVICE_NAME}.{DATABASE_NAME}.{table_name}"
                resp = self._client.get(f"/api/v1/tables/name/{alt_fqn}")

            if resp.status_code == 200:
                data = resp.json()
                self._table_ids[table_name] = data["id"]
                self._table_fqns[table_name] = data["fullyQualifiedName"]
                console.print(f"  ✓ [green]{data['fullyQualifiedName']}[/]")
            else:
                console.print(f"  [red]✗ {table_name} not found ({resp.status_code})[/]")

        if len(self._table_ids) < len(TABLE_NAMES):
            found = len(self._table_ids)
            console.print(
                f"\n  [yellow]⚠ Found {found}/{len(TABLE_NAMES)} tables. "
                f"Searching by service…[/]"
            )
            self._fallback_search()

    def _fallback_search(self) -> None:
        resp = self._client.get(
            "/api/v1/tables",
            params={"service": SERVICE_NAME, "limit": 50},
        )
        if resp.status_code != 200:
            return
        for t in resp.json().get("data", []):
            name = t["name"]
            if name in TABLE_NAMES and name not in self._table_ids:
                self._table_ids[name] = t["id"]
                self._table_fqns[name] = t["fullyQualifiedName"]
                console.print(f"  ✓ [green]{t['fullyQualifiedName']}[/] (via search)")

    # ── Step 4: Create lineage ──────────────────────────────────────────────

    # ── Step 5a: Enrich tables with tags, tiers, owners ──────────────────

    def _enrich_tables(self) -> None:
        console.print("[bold]5a/12[/] Enriching tables with tiers, owners, PII tags…")
        import json as _json

        for table_name in TABLE_NAMES:
            if table_name not in self._table_ids:
                continue

            table_id = self._table_ids[table_name]
            patches = []

            # Add tier tag
            tier_fqn = TABLE_TIERS.get(table_name)
            if tier_fqn:
                patches.append({
                    "op": "add",
                    "path": "/tags/0",
                    "value": {
                        "tagFQN": tier_fqn,
                        "source": "Classification",
                        "labelType": "Manual",
                        "state": "Confirmed",
                    },
                })

            # Add domain
            if self._domain_fqn:
                patches.append({
                    "op": "add",
                    "path": "/domain",
                    "value": {
                        "id": self._domain_fqn,
                        "type": "domain",
                        "name": DOMAIN_NAME.replace(" ", "-").lower(),
                        "fullyQualifiedName": self._domain_fqn,
                    },
                })

            # Add owner
            owner_team = TABLE_OWNERS.get(table_name)
            if owner_team:
                patches.append({
                    "op": "add",
                    "path": "/owners/0",
                    "value": {
                        "id": "",
                        "type": "team",
                        "name": owner_team,
                    },
                })

            if patches:
                resp = self._client.patch(
                    f"/api/v1/tables/{table_id}",
                    content=_json.dumps(patches),
                    headers={
                        **self._config.api_headers,
                        "Content-Type": "application/json-patch+json",
                    },
                )
                tier_label = TABLE_TIERS.get(table_name, "")
                if resp.status_code < 400:
                    console.print(
                        f"  ✓ {table_name}: {tier_label}, "
                        f"owner={owner_team or '—'}"
                    )
                else:
                    console.print(
                        f"  [yellow]⚠ {table_name}: {resp.status_code} "
                        f"{resp.text[:120]}[/]"
                    )

        # PII tags on specific columns
        for table_name, col_name in PII_COLUMNS:
            if table_name not in self._table_fqns:
                continue
            table_id = self._table_ids[table_name]
            col_patch = [{
                "op": "add",
                "path": f"/columns/{col_name}/tags/0",
                "value": {
                    "tagFQN": "PII.Sensitive",
                    "source": "Classification",
                    "labelType": "Manual",
                    "state": "Confirmed",
                },
            }]
            resp = self._client.patch(
                f"/api/v1/tables/{table_id}",
                content=_json.dumps(col_patch),
                headers={
                    **self._config.api_headers,
                    "Content-Type": "application/json-patch+json",
                },
            )
            status = "✓" if resp.status_code < 400 else "⚠"
            console.print(f"  {status} PII tag on {table_name}.{col_name}")

    # ── Step 5b: Create glossary ────────────────────────────────────────────

    def _create_glossary(self) -> None:
        console.print("[bold]5b/12[/] Creating business glossary…")

        # Create glossary
        glossary_payload = {
            "name": GLOSSARY_NAME,
            "displayName": "Supply Chain Glossary",
            "description": (
                "Business terminology for the supply chain analytics domain. "
                "Defines key metrics, dimensions, and business rules."
            ),
        }
        resp = self._client.put("/api/v1/glossaries", json=glossary_payload)
        if resp.status_code < 400:
            console.print(f"  ✓ Glossary [green]{GLOSSARY_NAME}[/]")
        else:
            console.print(f"  [yellow]⚠ Glossary: {resp.status_code}[/]")

        # Create glossary terms
        for term in GLOSSARY_TERMS:
            term_name = term["name"].replace(" ", "_")
            term_payload = {
                "name": term_name,
                "displayName": term["name"],
                "description": term["description"],
                "glossary": GLOSSARY_NAME,
            }
            resp = self._client.put("/api/v1/glossaryTerms", json=term_payload)
            if resp.status_code < 400:
                console.print(f"  ✓ Term [green]{term['name']}[/]")
            else:
                console.print(
                    f"  [yellow]⚠ {term['name']}: {resp.status_code} "
                    f"{resp.text[:100]}[/]"
                )

    # ── Step 6: Create lineage ──────────────────────────────────────────────

    def _create_lineage(self) -> None:
        console.print("[bold]6a/12[/] Creating lineage edges…")

        for edge in LINEAGE_EDGES:
            from_name = edge["from"]
            to_name = edge["to"]

            if from_name not in self._table_ids or to_name not in self._table_ids:
                console.print(f"  [yellow]⏭ Skipping {from_name} → {to_name} (table missing)[/]")
                continue

            from_fqn = self._table_fqns[from_name]
            to_fqn = self._table_fqns[to_name]

            column_lineage = [
                {
                    "fromColumns": [f"{from_fqn}.{from_col}"],
                    "toColumn": f"{to_fqn}.{to_col}",
                }
                for from_col, to_col in edge["column_mappings"]
            ]

            payload = {
                "edge": {
                    "fromEntity": {
                        "id": self._table_ids[from_name],
                        "type": "table",
                    },
                    "toEntity": {
                        "id": self._table_ids[to_name],
                        "type": "table",
                    },
                    "lineageDetails": {
                        "columnsLineage": column_lineage,
                        "description": f"ETL: {from_name} → {to_name}",
                    },
                },
            }
            resp = self._client.put("/api/v1/lineage", json=payload)
            if resp.status_code < 400:
                console.print(
                    f"  ✓ {from_name} → {to_name} "
                    f"({len(edge['column_mappings'])} columns)"
                )
            else:
                console.print(
                    f"  [yellow]⚠ {from_name} → {to_name}: {resp.status_code}[/]"
                )

    # ── Step 6b: Push sample data from MySQL ────────────────────────────────

    def _push_sample_data(self) -> None:
        """Fetch sample rows from MySQL and push to OM so tables show data."""
        import subprocess

        console.print("[bold]6b/12[/] Pushing sample data from MySQL…")
        mysql = self._config.mysql
        mysql_cmd_prefix = (
            f"docker exec openmetadata_mysql mysql "
            f"-u{mysql.user} -p{mysql.password} -N -B -e"
        )

        for table_name in TABLE_NAMES:
            if table_name not in self._table_ids:
                continue

            table_id = self._table_ids[table_name]
            col_names = [c["name"] for c in self.TABLE_SCHEMAS[table_name]]
            cols_sql = ", ".join(col_names)

            result = subprocess.run(
                f'{mysql_cmd_prefix} '
                f'"SELECT {cols_sql} FROM {mysql.database}.{table_name} LIMIT 50;"',
                shell=True,
                capture_output=True,
                text=True,
            )

            rows = []
            for line in result.stdout.strip().split("\n"):
                if line.strip():
                    rows.append(line.split("\t"))

            if not rows:
                console.print(f"  [yellow]⏭ {table_name}: no rows in MySQL[/]")
                continue

            payload = {"columns": col_names, "rows": rows}
            resp = self._client.put(
                f"/api/v1/tables/{table_id}/sampleData",
                json=payload,
            )
            if resp.status_code < 400:
                console.print(f"  ✓ {table_name}: {len(rows)} sample rows")
            else:
                console.print(
                    f"  [yellow]⚠ {table_name}: {resp.status_code}[/]"
                )

    # ── Step 6c: Push table profiles (row counts) ───────────────────────────

    def _push_table_profiles(self) -> None:
        """Push row count profiles so tables show data stats in OM UI."""
        import subprocess
        import time

        console.print("[bold]6c/12[/] Pushing table profiles (row counts)…")
        mysql = self._config.mysql
        ts = int(time.time() * 1000)

        for table_name in TABLE_NAMES:
            if table_name not in self._table_ids:
                continue

            table_id = self._table_ids[table_name]
            col_count = len(self.TABLE_SCHEMAS[table_name])

            result = subprocess.run(
                f"docker exec openmetadata_mysql mysql "
                f"-u{mysql.user} -p{mysql.password} -N -B -e "
                f'"SELECT COUNT(*) FROM {mysql.database}.{table_name};"',
                shell=True,
                capture_output=True,
                text=True,
            )
            row_count = (
                int(result.stdout.strip())
                if result.stdout.strip().isdigit()
                else 0
            )

            profile_payload = {
                "tableProfile": {
                    "timestamp": ts,
                    "rowCount": row_count,
                    "columnCount": col_count,
                },
                "columnProfile": [],
            }
            resp = self._client.put(
                f"/api/v1/tables/{table_id}/tableProfile",
                json=profile_payload,
            )
            if resp.status_code < 400:
                console.print(f"  ✓ {table_name}: {row_count:,} rows")
            else:
                console.print(
                    f"  [yellow]⚠ {table_name}: {resp.status_code} "
                    f"{resp.text[:100]}[/]"
                )

    # ── Step 7: Create test cases ───────────────────────────────────────────

    def _create_test_cases(self) -> None:
        console.print("[bold]7/12[/] Creating data quality test cases…")

        for tc in TEST_CASES:
            table_name = tc["table"]
            if table_name not in self._table_fqns:
                console.print(f"  [yellow]⏭ Skipping {tc['name']} (table missing)[/]")
                continue

            table_fqn = self._table_fqns[table_name]
            entity_link = f"<#E::table::{table_fqn}::columns::{tc['column']}>"

            payload = {
                "name": tc["name"],
                "entityLink": entity_link,
                "testDefinition": tc["testDefinition"],
                "parameterValues": tc["params"],
                "description": f"DQ check on {table_name}.{tc['column']}",
            }
            resp = self._client.post("/api/v1/dataQuality/testCases", json=payload)
            if resp.status_code == 409:
                console.print(f"  ℹ {tc['name']} already exists")
            elif resp.status_code < 400:
                label = "[red]WILL FAIL[/]" if tc["should_fail"] else "[green]WILL PASS[/]"
                console.print(f"  ✓ {tc['name']} — {label}")
            else:
                console.print(
                    f"  [yellow]⚠ {tc['name']}: {resp.status_code} "
                    f"{resp.text[:150]}[/]"
                )

    # ── Step 6: Seed test results ───────────────────────────────────────────

    def _seed_test_result_history(self) -> None:
        """Seed 8 historical test results per test case for trend analysis."""
        console.print("[bold]8/12[/] Seeding test result history (8 runs per test)…")
        from datetime import timedelta
        now = datetime.now(timezone.utc)

        # Historical patterns: when did failures start?
        # Tests were passing until ~4 runs ago, then started failing
        HISTORY_PATTERNS: dict[str, list[str]] = {
            # test_name → list of 8 statuses (oldest first)
            "raw_orders_date_not_in_future":       ["Success"] * 4 + ["Failed"] * 4,
            "raw_orders_quantity_not_null":          ["Success"] * 8,
            "staging_orders_total_price_positive":   ["Success"] * 4 + ["Failed"] * 4,
            "fact_order_metrics_revenue_not_null":    ["Success"] * 8,
            "exec_kpis_revenue_reasonable":          ["Success"] * 5 + ["Failed"] * 3,
        }

        for tc in TEST_CASES:
            table_name = tc["table"]
            if table_name not in self._table_fqns:
                continue

            table_fqn = self._table_fqns[table_name]
            tc_fqn = f"{table_fqn}.{tc['column']}.{tc['name']}"
            pattern = HISTORY_PATTERNS.get(tc["name"], ["Success"] * 8)

            seeded = 0
            for i, status in enumerate(pattern):
                ts = now - timedelta(days=(len(pattern) - 1 - i) * 2)
                ts_ms = int(ts.timestamp() * 1000)

                if status == "Failed":
                    result_payload = {
                        "timestamp": ts_ms,
                        "testCaseStatus": "Failed",
                        "result": tc["fail_message"],
                        "testResultValue": [
                            {"name": "resultMessage", "value": tc["fail_message"]},
                        ],
                    }
                else:
                    result_payload = {
                        "timestamp": ts_ms,
                        "testCaseStatus": "Success",
                        "result": "All values within expected range.",
                        "testResultValue": [
                            {"name": "resultMessage", "value": "All values within expected range."},
                        ],
                    }

                resp = self._client.post(
                    f"/api/v1/dataQuality/testCases/testCaseResults/{tc_fqn}",
                    json=result_payload,
                )
                if resp.status_code < 400:
                    seeded += 1

            fail_count = pattern.count("Failed")
            if fail_count > 0:
                console.print(
                    f"  [red]✗[/] {tc['name']}: {seeded} results "
                    f"([red]{fail_count} failures[/], first failure ~{fail_count * 2}d ago)"
                )
            else:
                console.print(
                    f"  [green]✓[/] {tc['name']}: {seeded} results (all passing)"
                )

    # ── Summary ─────────────────────────────────────────────────────────────

    def _print_summary(self) -> None:
        console.print("")
        table = RichTable(title="DataPulse — OpenMetadata Provisioning Summary")
        table.add_column("Component", style="cyan")
        table.add_column("Count", justify="right", style="green")

        table.add_row("Teams created", str(len(TEAMS_TO_CREATE)))
        table.add_row("Domain", DOMAIN_NAME)
        table.add_row("Glossary terms", str(len(GLOSSARY_TERMS)))
        table.add_row("Tables discovered", str(len(self._table_ids)))
        table.add_row("Lineage edges", str(len(LINEAGE_EDGES)))
        table.add_row("Sample data pushed", f"{len(self._table_ids)} tables")
        table.add_row("Table profiles pushed", f"{len(self._table_ids)} tables")
        table.add_row("Test cases", str(len(TEST_CASES)))
        table.add_row(
            "Historical results seeded",
            str(len(TEST_CASES) * 8),
        )
        table.add_row(
            "Seeded failures",
            str(sum(1 for tc in TEST_CASES if tc["should_fail"])),
        )
        console.print(table)

        console.print(
            "\n[bold yellow]Hidden Fault:[/] "
            "[white]raw_orders.order_date[/] has 847 future-dated rows.\n"
            "Propagation: [white]raw_orders → staging_orders → "
            "fact_order_metrics → exec_dashboard_kpis[/]\n"
            "\n[bold]Next step:[/] Run the Sentinel agent to detect these failures.\n"
        )

    # ── Helpers ─────────────────────────────────────────────────────────────

    def _put(self, endpoint: str, payload: dict) -> dict:
        resp = self._client.put(endpoint, json=payload)
        if resp.status_code >= 400:
            console.print(f"  [red]ERROR {resp.status_code}[/]: {resp.text[:200]}")
            resp.raise_for_status()
        return resp.json()


def main() -> None:
    config = DataPulseConfig.from_env()

    provisioner = MetadataProvisioner(config)
    try:
        provisioner.provision_all()
    finally:
        provisioner.close()


if __name__ == "__main__":
    main()

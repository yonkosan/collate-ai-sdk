# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""Provision a 5-table supply-chain pipeline in OpenMetadata with realistic faults.

This script creates:
  1. A "DataPulse_SupplyChain" database service (CustomDatabase type)
  2. A database, schema, and 5 interconnected tables
  3. Column-level lineage forming a realistic analytics pipeline
  4. Data quality test cases on critical columns
  5. Seeded test failures that simulate a hidden upstream fault

Pipeline topology:
  raw_orders ──┐
               ├──► staging_orders ──► fact_order_metrics ──► exec_dashboard_kpis
  raw_products ┘                                         ┌──►
  raw_suppliers ──► staging_suppliers ──► fact_supply_chain

Hidden faults:
  - raw_orders.order_date contains future dates → test FAILS
  - Propagates silently to fact_order_metrics and exec_dashboard_kpis

Usage:
    python -m bootstrap.provision_metadata

    # Or with custom host:
    OPENMETADATA_HOST=http://localhost:8585 python -m bootstrap.provision_metadata
"""

from __future__ import annotations

import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import httpx
from rich.console import Console
from rich.table import Table as RichTable

# Allow running as `python -m bootstrap.provision_metadata` from solutions/ai_data_sre/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.config import DataPulseConfig

console = Console()

# ─── Constants ──────────────────────────────────────────────────────────────────

SERVICE_NAME = "DataPulse_SupplyChain"
DATABASE_NAME = "supply_chain_analytics"
SCHEMA_NAME = "public"
SERVICE_FQN = SERVICE_NAME
DATABASE_FQN = f"{SERVICE_NAME}.{DATABASE_NAME}"
SCHEMA_FQN = f"{DATABASE_FQN}.{SCHEMA_NAME}"

# ─── Table definitions ─────────────────────────────────────────────────────────

TABLES: dict[str, list[dict]] = {
    "raw_orders": [
        {"name": "order_id", "dataType": "INT", "description": "Unique order identifier"},
        {"name": "customer_id", "dataType": "INT", "description": "FK to customers"},
        {"name": "product_id", "dataType": "INT", "description": "FK to products"},
        {"name": "order_date", "dataType": "DATE", "description": "Date the order was placed"},
        {"name": "quantity", "dataType": "INT", "description": "Units ordered"},
        {"name": "unit_price", "dataType": "DECIMAL", "description": "Price per unit"},
        {"name": "status", "dataType": "VARCHAR", "dataLength": 50, "description": "Order status"},
    ],
    "raw_products": [
        {"name": "product_id", "dataType": "INT", "description": "Unique product identifier"},
        {"name": "product_name", "dataType": "VARCHAR", "dataLength": 200, "description": "Product name"},
        {"name": "category", "dataType": "VARCHAR", "dataLength": 100, "description": "Product category"},
        {"name": "supplier_id", "dataType": "INT", "description": "FK to suppliers"},
        {"name": "cost_price", "dataType": "DECIMAL", "description": "Wholesale cost"},
        {"name": "sku", "dataType": "VARCHAR", "dataLength": 50, "description": "Stock keeping unit"},
    ],
    "raw_suppliers": [
        {"name": "supplier_id", "dataType": "INT", "description": "Unique supplier identifier"},
        {"name": "supplier_name", "dataType": "VARCHAR", "dataLength": 200, "description": "Supplier name"},
        {"name": "country", "dataType": "VARCHAR", "dataLength": 100, "description": "Supplier country"},
        {"name": "lead_time_days", "dataType": "INT", "description": "Average lead time in days"},
        {"name": "reliability_score", "dataType": "DECIMAL", "description": "Reliability rating 0-1"},
    ],
    "staging_orders": [
        {"name": "order_id", "dataType": "INT", "description": "Order identifier"},
        {"name": "customer_id", "dataType": "INT", "description": "Customer identifier"},
        {"name": "product_name", "dataType": "VARCHAR", "dataLength": 200, "description": "Denormalized product name"},
        {"name": "category", "dataType": "VARCHAR", "dataLength": 100, "description": "Product category"},
        {"name": "order_date", "dataType": "DATE", "description": "Validated order date"},
        {"name": "quantity", "dataType": "INT", "description": "Units ordered"},
        {"name": "total_price", "dataType": "DECIMAL", "description": "quantity * unit_price"},
        {"name": "status", "dataType": "VARCHAR", "dataLength": 50, "description": "Order status"},
    ],
    "staging_suppliers": [
        {"name": "supplier_id", "dataType": "INT", "description": "Supplier identifier"},
        {"name": "supplier_name", "dataType": "VARCHAR", "dataLength": 200, "description": "Cleaned supplier name"},
        {"name": "country", "dataType": "VARCHAR", "dataLength": 100, "description": "ISO country code"},
        {"name": "lead_time_days", "dataType": "INT", "description": "Validated lead time"},
        {"name": "reliability_score", "dataType": "DECIMAL", "description": "Normalized score"},
    ],
    "fact_order_metrics": [
        {"name": "metric_date", "dataType": "DATE", "description": "Aggregation date"},
        {"name": "total_orders", "dataType": "INT", "description": "Number of orders"},
        {"name": "total_revenue", "dataType": "DECIMAL", "description": "Sum of total_price"},
        {"name": "avg_order_value", "dataType": "DECIMAL", "description": "Average order value"},
        {"name": "top_category", "dataType": "VARCHAR", "dataLength": 100, "description": "Highest-revenue category"},
    ],
    "fact_supply_chain": [
        {"name": "supplier_id", "dataType": "INT", "description": "Supplier identifier"},
        {"name": "supplier_name", "dataType": "VARCHAR", "dataLength": 200, "description": "Supplier name"},
        {"name": "avg_lead_time", "dataType": "DECIMAL", "description": "Average lead time"},
        {"name": "reliability_grade", "dataType": "VARCHAR", "dataLength": 1, "description": "A/B/C/D/F grade"},
        {"name": "total_products_supplied", "dataType": "INT", "description": "Product count"},
    ],
    "exec_dashboard_kpis": [
        {"name": "kpi_date", "dataType": "DATE", "description": "KPI reporting date"},
        {"name": "daily_revenue", "dataType": "DECIMAL", "description": "Daily revenue from fact_order_metrics"},
        {"name": "order_volume", "dataType": "INT", "description": "Daily order count"},
        {"name": "supply_risk_score", "dataType": "DECIMAL", "description": "Composite supply chain risk"},
        {"name": "top_supplier", "dataType": "VARCHAR", "dataLength": 200, "description": "Most reliable supplier"},
    ],
}

# Lineage edges: (from_table, from_columns) → (to_table, to_columns)
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
            {"name": "maxValue", "value": "2026-04-23"},
        ],
        "should_fail": True,
        "fail_message": "Found 847 rows with order_date in the future (max: 2027-11-15). "
        "Expected all values between 2020-01-01 and 2026-04-23.",
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
        "fail_message": "Found 847 rows with negative total_price (min: -4250.00). "
        "Caused by upstream raw_orders.order_date containing future dates "
        "that bypass date-based pricing logic.",
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
        "fail_message": "Found 23 rows with daily_revenue outside expected range "
        "(max: 48,721,500.00). Likely caused by upstream data quality issues "
        "propagating through the pipeline.",
    },
]


class OpenMetadataProvisioner:
    """Provisions the supply-chain pipeline in an OpenMetadata instance."""

    def __init__(self, config: DataPulseConfig) -> None:
        self._config = config
        self._client = httpx.Client(
            base_url=config.openmetadata_host,
            headers=config.api_headers,
            timeout=30.0,
        )
        self._table_ids: dict[str, str] = {}
        self._table_fqns: dict[str, str] = {}

    def close(self) -> None:
        self._client.close()

    # ── Public API ──────────────────────────────────────────────────────────

    def provision_all(self) -> None:
        """Run the full provisioning pipeline."""
        console.rule("[bold cyan]DataPulse — Chaos Playground Provisioner")
        self._create_service()
        self._create_database()
        self._create_schema()
        self._create_tables()
        self._create_lineage()
        self._create_test_cases()
        self._seed_test_results()
        self._print_summary()
        console.rule("[bold green]Provisioning complete!")

    # ── Service / Database / Schema ─────────────────────────────────────────

    def _create_service(self) -> None:
        console.print("\n[bold]1/7[/] Creating database service…")
        payload = {
            "name": SERVICE_NAME,
            "serviceType": "CustomDatabase",
            "description": "DataPulse demo — supply chain analytics pipeline with hidden faults.",
            "connection": {
                "config": {
                    "type": "CustomDatabase",
                    "sourcePythonClass": "metadata.ingestion.source.database.customDatabase.metadata.CustomDatabaseSource",
                }
            },
        }
        resp = self._put("/api/v1/services/databaseServices", payload)
        console.print(f"  ✓ Service [green]{SERVICE_NAME}[/] ready (id: {resp['id'][:8]}…)")

    def _create_database(self) -> None:
        console.print("[bold]2/7[/] Creating database…")
        payload = {
            "name": DATABASE_NAME,
            "service": SERVICE_FQN,
            "description": "Supply chain analytics database for DataPulse demo.",
        }
        resp = self._put("/api/v1/databases", payload)
        console.print(f"  ✓ Database [green]{DATABASE_NAME}[/] ready")

    def _create_schema(self) -> None:
        console.print("[bold]3/7[/] Creating schema…")
        payload = {
            "name": SCHEMA_NAME,
            "database": DATABASE_FQN,
            "description": "Default schema for supply chain tables.",
        }
        resp = self._put("/api/v1/databaseSchemas", payload)
        console.print(f"  ✓ Schema [green]{SCHEMA_FQN}[/] ready")

    # ── Tables ──────────────────────────────────────────────────────────────

    def _create_tables(self) -> None:
        console.print("[bold]4/7[/] Creating tables…")
        for table_name, columns in TABLES.items():
            fqn = f"{SCHEMA_FQN}.{table_name}"
            payload = {
                "name": table_name,
                "databaseSchema": SCHEMA_FQN,
                "columns": columns,
                "tableType": "Regular",
                "description": f"Supply chain table: {table_name}",
            }
            resp = self._put("/api/v1/tables", payload)
            self._table_ids[table_name] = resp["id"]
            self._table_fqns[table_name] = resp["fullyQualifiedName"]
            console.print(f"  ✓ [green]{table_name}[/] ({len(columns)} columns)")

    # ── Lineage ─────────────────────────────────────────────────────────────

    def _create_lineage(self) -> None:
        console.print("[bold]5/7[/] Creating lineage edges…")
        for edge in LINEAGE_EDGES:
            from_id = self._table_ids[edge["from"]]
            to_id = self._table_ids[edge["to"]]
            from_fqn = self._table_fqns[edge["from"]]
            to_fqn = self._table_fqns[edge["to"]]

            column_lineage = []
            for from_col, to_col in edge["column_mappings"]:
                column_lineage.append({
                    "fromColumns": [f"{from_fqn}.{from_col}"],
                    "toColumn": f"{to_fqn}.{to_col}",
                })

            payload = {
                "edge": {
                    "fromEntity": {"id": from_id, "type": "table"},
                    "toEntity": {"id": to_id, "type": "table"},
                    "lineageDetails": {
                        "columnsLineage": column_lineage,
                        "description": f"Data flows from {edge['from']} to {edge['to']}",
                    },
                },
            }
            self._client.put("/api/v1/lineage", json=payload)
            console.print(f"  ✓ {edge['from']} → {edge['to']} ({len(edge['column_mappings'])} columns)")

    # ── Test Cases ──────────────────────────────────────────────────────────

    def _create_test_cases(self) -> None:
        console.print("[bold]6/7[/] Creating data quality test cases…")
        for tc in TEST_CASES:
            table_fqn = self._table_fqns[tc["table"]]
            entity_link = f"<#E::table::{table_fqn}::columns::{tc['column']}>"

            payload = {
                "name": tc["name"],
                "entityLink": entity_link,
                "testDefinition": tc["testDefinition"],
                "testSuite": table_fqn,
                "parameterValues": tc["params"],
                "description": f"DQ check on {tc['table']}.{tc['column']}",
            }
            self._put("/api/v1/dataQuality/testCases", payload)
            status = "[red]WILL FAIL[/]" if tc["should_fail"] else "[green]WILL PASS[/]"
            console.print(f"  ✓ {tc['name']} — {status}")

    def _seed_test_results(self) -> None:
        console.print("[bold]7/7[/] Seeding test results…")
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

        for tc in TEST_CASES:
            table_fqn = self._table_fqns[tc["table"]]
            tc_fqn = f"{table_fqn}.{tc['column']}.{tc['name']}"

            if tc["should_fail"]:
                result_payload = {
                    "timestamp": now_ms,
                    "testCaseStatus": "Failed",
                    "result": tc["fail_message"],
                    "testResultValue": [
                        {"name": "resultMessage", "value": tc["fail_message"]},
                    ],
                }
            else:
                result_payload = {
                    "timestamp": now_ms,
                    "testCaseStatus": "Success",
                    "result": "All values within expected range.",
                    "testResultValue": [
                        {"name": "resultMessage", "value": "All values within expected range."},
                    ],
                }

            self._client.put(
                f"/api/v1/dataQuality/testCases/{tc_fqn}/testCaseResult",
                json=result_payload,
            )
            icon = "✗" if tc["should_fail"] else "✓"
            color = "red" if tc["should_fail"] else "green"
            console.print(f"  [{color}]{icon}[/] {tc['name']}: {'FAILED' if tc['should_fail'] else 'PASSED'}")

    # ── Helpers ─────────────────────────────────────────────────────────────

    def _put(self, endpoint: str, payload: dict) -> dict:
        """PUT request with idempotent create-or-update semantics."""
        resp = self._client.put(endpoint, json=payload)
        if resp.status_code >= 400:
            console.print(f"  [red]ERROR {resp.status_code}[/]: {resp.text[:200]}")
            resp.raise_for_status()
        return resp.json()

    def _print_summary(self) -> None:
        console.print("\n")
        table = RichTable(title="DataPulse Chaos Playground — Summary")
        table.add_column("Component", style="cyan")
        table.add_column("Count", justify="right", style="green")
        table.add_row("Tables", str(len(TABLES)))
        table.add_row("Lineage edges", str(len(LINEAGE_EDGES)))
        table.add_row("Test cases", str(len(TEST_CASES)))
        table.add_row("Seeded failures", str(sum(1 for tc in TEST_CASES if tc["should_fail"])))
        console.print(table)

        console.print(
            "\n[bold yellow]Hidden Fault:[/] [white]raw_orders.order_date[/] contains future dates.\n"
            "This propagates through [white]staging_orders → fact_order_metrics → exec_dashboard_kpis[/].\n"
            "The Sentinel agent should detect the test failures.\n"
            "The Investigator should trace lineage back to [white]raw_orders.order_date[/] as root cause.\n"
            "The Narrator should report the full blast radius including the executive dashboard.\n"
        )


def main() -> None:
    try:
        config = DataPulseConfig.from_env()
    except ValueError as exc:
        console.print(f"[red]Configuration error:[/] {exc}")
        raise SystemExit(1) from exc

    provisioner = OpenMetadataProvisioner(config)
    try:
        provisioner.provision_all()
    finally:
        provisioner.close()


if __name__ == "__main__":
    main()

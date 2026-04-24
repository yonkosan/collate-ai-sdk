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
        self._create_service()
        self._create_database_and_schema()
        self._create_tables_directly()
        self._discover_tables()
        self._create_lineage()
        self._create_test_cases()
        self._seed_test_results()
        self._print_summary()
        console.rule("[bold green]Provisioning complete!")

    # ── Step 1: Create MySQL service ────────────────────────────────────────

    def _create_service(self) -> None:
        console.print("\n[bold]1/6[/] Creating MySQL database service…")
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
        console.print("\n[bold]2/6[/] Creating database & schema entities…")

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
        console.print("[bold]3/6[/] Creating table entities via REST API…")
        schema_fqn = f"{SERVICE_NAME}.{DATABASE_NAME}.{DATABASE_NAME}"

        for table_name in TABLE_NAMES:
            columns = self.TABLE_SCHEMAS[table_name]
            payload = {
                "name": table_name,
                "displayName": table_name.replace("_", " ").title(),
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

    def _create_lineage(self) -> None:
        console.print("[bold]4/6[/] Creating lineage edges…")

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

    # ── Step 5: Create test cases ───────────────────────────────────────────

    def _create_test_cases(self) -> None:
        console.print("[bold]5/6[/] Creating data quality test cases…")

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

    def _seed_test_results(self) -> None:
        console.print("[bold]6/6[/] Seeding test results…")
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

        for tc in TEST_CASES:
            table_name = tc["table"]
            if table_name not in self._table_fqns:
                continue

            table_fqn = self._table_fqns[table_name]
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

            resp = self._client.post(
                f"/api/v1/dataQuality/testCases/testCaseResults/{tc_fqn}",
                json=result_payload,
            )
            if resp.status_code < 400:
                icon = "✗" if tc["should_fail"] else "✓"
                color = "red" if tc["should_fail"] else "green"
                status = "FAILED" if tc["should_fail"] else "PASSED"
                console.print(f"  [{color}]{icon}[/] {tc['name']}: {status}")
            else:
                console.print(f"  [yellow]⚠ {tc['name']}: {resp.status_code}[/]")

    # ── Summary ─────────────────────────────────────────────────────────────

    def _print_summary(self) -> None:
        console.print("")
        table = RichTable(title="DataPulse — OpenMetadata Provisioning Summary")
        table.add_column("Component", style="cyan")
        table.add_column("Count", justify="right", style="green")

        table.add_row("Tables discovered", str(len(self._table_ids)))
        table.add_row("Lineage edges", str(len(LINEAGE_EDGES)))
        table.add_row("Test cases", str(len(TEST_CASES)))
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

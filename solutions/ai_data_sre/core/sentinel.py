# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""Sentinel agent — polls OpenMetadata for DQ test failures and creates Incidents.

The Sentinel is the first agent in the DataPulse pipeline:
  1. Polls /api/v1/dataQuality/testCases for Failed results
  2. Groups failures by table
  3. Assigns initial severity based on failure count and position in pipeline
  4. Creates Incident objects for the Investigator

Usage:
    from core.sentinel import Sentinel
    sentinel = Sentinel(config)
    incidents = sentinel.scan()
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

import httpx
from rich.console import Console

from core.config import DataPulseConfig
from core.models import Incident, IncidentStatus, Severity, TestFailure, TestHistory, TestResultRecord

console = Console()

# Tables deeper in the pipeline indicate wider blast radius
_PIPELINE_DEPTH: dict[str, int] = {
    "raw_orders": 0,
    "raw_products": 0,
    "raw_suppliers": 0,
    "staging_orders": 1,
    "staging_suppliers": 1,
    "fact_order_metrics": 2,
    "fact_supply_chain": 2,
    "exec_dashboard_kpis": 3,
}


class Sentinel:
    """Detects data quality failures and emits Incidents."""

    def __init__(self, config: DataPulseConfig) -> None:
        self._config = config
        self._client = httpx.Client(
            base_url=config.openmetadata_host,
            headers=config.api_headers,
            timeout=30.0,
        )

    def close(self) -> None:
        self._client.close()

    def scan(self) -> list[Incident]:
        """Poll OpenMetadata for failed test cases and return Incidents."""
        console.print("\n[bold cyan]🔍 Sentinel scanning for DQ failures…[/]")

        failures = self._fetch_failed_tests()
        if not failures:
            console.print("  [green]✓ No failures detected.[/]")
            return []

        console.print(f"  Found [red]{len(failures)}[/] failed test case(s)")

        # Group failures by table
        by_table: dict[str, list[TestFailure]] = defaultdict(list)
        for f in failures:
            by_table[f.table_fqn].append(f)

        incidents = []
        for table_fqn, table_failures in by_table.items():
            incident = self._create_incident(table_fqn, table_failures)
            # Fetch failure history for each test case
            for f in table_failures:
                history = self._fetch_test_history(f)
                if history:
                    incident.failure_histories.append(history)
            incidents.append(incident)
            console.print(
                f"  📋 Incident [bold]{incident.id}[/]: "
                f"[yellow]{incident.severity.name}[/] — {incident.title} "
                f"({len(table_failures)} failure(s))"
            )

        console.print(
            f"\n[bold]Sentinel complete:[/] "
            f"{len(incidents)} incident(s) from {len(failures)} failure(s)\n"
        )
        return incidents

    def _fetch_failed_tests(self) -> list[TestFailure]:
        """Fetch all test cases with Failed status from OpenMetadata."""
        failures: list[TestFailure] = []

        resp = self._client.get(
            "/api/v1/dataQuality/testCases",
            params={
                "limit": 100,
                "fields": "testCaseResult",
                "testCaseStatus": "Failed",
            },
        )
        if resp.status_code != 200:
            console.print(f"  [red]API error: {resp.status_code}[/]")
            return failures

        data = resp.json()
        for tc in data.get("data", []):
            result = tc.get("testCaseResult")
            if not result:
                continue

            status = result.get("testCaseStatus", "")
            if status != "Failed":
                continue

            fqn = tc.get("fullyQualifiedName", "")
            # FQN: service.db.schema.table.column.testName
            parts = fqn.rsplit(".", 2)
            table_fqn = parts[0] if len(parts) >= 2 else fqn
            column = parts[1] if len(parts) >= 3 else None

            result_msg = result.get("result", "")
            if not result_msg:
                values = result.get("testResultValue", [])
                result_msg = values[0].get("value", "") if values else "No details"

            failures.append(
                TestFailure(
                    test_case_id=tc["id"],
                    test_case_name=tc["name"],
                    table_fqn=table_fqn,
                    column=column,
                    test_definition=tc.get("testDefinition", {}).get("name", "unknown"),
                    result_message=result_msg,
                    timestamp=datetime.now(timezone.utc),
                )
            )

        return failures

    def _create_incident(
        self, table_fqn: str, failures: list[TestFailure]
    ) -> Incident:
        """Create an Incident from grouped failures with severity assessment."""
        table_short = table_fqn.rsplit(".", 1)[-1]
        depth = _PIPELINE_DEPTH.get(table_short, 0)

        severity = self._assess_severity(failures, depth)
        title = f"DQ failures on {table_short} ({len(failures)} tests failed)"

        return Incident(
            title=title,
            severity=severity,
            status=IncidentStatus.DETECTED,
            failures=failures,
        )

    @staticmethod
    def _assess_severity(failures: list[TestFailure], depth: int) -> Severity:
        """Assign severity based on failure count and pipeline position.

        - Multiple failures or downstream tables → CRITICAL/HIGH
        - Single failure on raw table → MEDIUM
        """
        if len(failures) >= 3:
            return Severity.CRITICAL
        if depth >= 2:
            return Severity.CRITICAL
        if len(failures) >= 2:
            return Severity.HIGH
        if depth >= 1:
            return Severity.HIGH
        return Severity.MEDIUM

    def _fetch_test_history(self, failure: TestFailure) -> TestHistory | None:
        """Fetch last 10 historical results for a test case."""
        from datetime import timedelta

        now = datetime.now(timezone.utc)
        start_ts = int((now - timedelta(days=30)).timestamp() * 1000)
        end_ts = int(now.timestamp() * 1000)

        fqn = f"{failure.table_fqn}.{failure.column}.{failure.test_case_name}" if failure.column else failure.test_case_name
        # Use the test case ID directly for history — the FQN is only for reference
        resp = self._client.get(
            f"/api/v1/dataQuality/testCases/{failure.test_case_id}/testCaseResult",
            params={"startTs": start_ts, "endTs": end_ts, "limit": 10},
        )
        if resp.status_code != 200:
            return None

        data = resp.json()
        results_raw = data.get("data", [])
        if not results_raw:
            return None

        records = []
        for r in results_raw:
            ts_ms = r.get("timestamp", 0)
            records.append(TestResultRecord(
                timestamp=datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc),
                status=r.get("testCaseStatus", "Unknown"),
                result_message=r.get("result", ""),
            ))

        # Sort oldest first
        records.sort(key=lambda r: r.timestamp)

        failure_count = sum(1 for r in records if r.status == "Failed")
        first_fail = next((r.timestamp for r in records if r.status == "Failed"), None)

        return TestHistory(
            test_case_name=failure.test_case_name,
            results=records,
            total_runs=len(records),
            failure_count=failure_count,
            first_failure=first_fail,
            is_recurring=failure_count >= 2,
        )


def main() -> None:
    """Run the Sentinel as a standalone script."""
    config = DataPulseConfig.from_env()
    sentinel = Sentinel(config)
    try:
        incidents = sentinel.scan()
        if incidents:
            console.print("[bold]Incidents ready for investigation:[/]")
            for inc in incidents:
                console.print(f"  • {inc.id}: {inc.title} [{inc.severity.name}]")
                for f in inc.failures:
                    console.print(f"      └─ {f.test_case_name}: {f.result_message[:80]}")
    finally:
        sentinel.close()


if __name__ == "__main__":
    main()

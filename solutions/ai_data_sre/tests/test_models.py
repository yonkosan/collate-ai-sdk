# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""Unit tests for DataPulse domain models."""

from datetime import datetime, timezone

from core.models import (
    AffectedAsset,
    BlastRadius,
    Incident,
    IncidentReport,
    IncidentStatus,
    Severity,
    TestFailure,
)


class TestSeverity:
    def test_ordering(self):
        assert Severity.CRITICAL < Severity.HIGH < Severity.MEDIUM < Severity.LOW < Severity.INFO

    def test_critical_is_most_severe(self):
        assert Severity.CRITICAL.value == 1

    def test_info_is_least_severe(self):
        assert Severity.INFO.value == 5


class TestIncidentStatus:
    def test_detected_value(self):
        assert IncidentStatus.DETECTED == "detected"

    def test_all_statuses_are_strings(self):
        for status in IncidentStatus:
            assert isinstance(status.value, str)


class TestTestFailure:
    def test_create_minimal(self):
        f = TestFailure(
            test_case_id="tc-1",
            test_case_name="col_values_between",
            table_fqn="svc.db.schema.orders",
            test_definition="columnValuesToBeBetween",
            result_message="Found 847 rows outside range",
        )
        assert f.test_case_id == "tc-1"
        assert f.column is None
        assert isinstance(f.timestamp, datetime)

    def test_create_with_column(self):
        f = TestFailure(
            test_case_id="tc-2",
            test_case_name="col_not_null",
            table_fqn="svc.db.schema.orders",
            column="order_date",
            test_definition="columnValuesNotNull",
            result_message="12 null values",
        )
        assert f.column == "order_date"


class TestAffectedAsset:
    def test_defaults(self):
        a = AffectedAsset(fqn="svc.db.schema.table", entity_type="table")
        assert a.display_name is None
        assert a.owners == []
        assert a.depth == 0


class TestBlastRadius:
    def test_defaults(self):
        br = BlastRadius(root_cause_table="svc.db.schema.raw_orders")
        assert br.root_cause_column is None
        assert br.upstream_chain == []
        assert br.downstream_impact == []
        assert br.total_affected_assets == 0

    def test_with_assets(self):
        br = BlastRadius(
            root_cause_table="svc.db.schema.raw_orders",
            root_cause_column="order_date",
            upstream_chain=[
                AffectedAsset(fqn="svc.db.schema.raw_products", entity_type="table", depth=1)
            ],
            downstream_impact=[
                AffectedAsset(fqn="svc.db.schema.staging_orders", entity_type="table", depth=1),
                AffectedAsset(fqn="svc.db.schema.fact_metrics", entity_type="table", depth=2),
            ],
            total_affected_assets=4,
        )
        assert len(br.upstream_chain) == 1
        assert len(br.downstream_impact) == 2
        assert br.total_affected_assets == 4


class TestIncident:
    def _make_incident(self, **kwargs):
        defaults = dict(title="Test incident", severity=Severity.MEDIUM)
        defaults.update(kwargs)
        return Incident(**defaults)

    def test_auto_id(self):
        inc = self._make_incident()
        assert len(inc.id) == 12

    def test_default_status(self):
        inc = self._make_incident()
        assert inc.status == IncidentStatus.DETECTED

    def test_escalate(self):
        inc = self._make_incident(severity=Severity.MEDIUM)
        old_updated = inc.updated_at
        inc.escalate(Severity.CRITICAL)
        assert inc.severity == Severity.CRITICAL
        assert inc.updated_at >= old_updated

    def test_transition(self):
        inc = self._make_incident()
        inc.transition(IncidentStatus.INVESTIGATING)
        assert inc.status == IncidentStatus.INVESTIGATING

    def test_with_failures(self):
        f = TestFailure(
            test_case_id="tc-1",
            test_case_name="test",
            table_fqn="svc.db.schema.t",
            test_definition="def",
            result_message="msg",
        )
        inc = self._make_incident(failures=[f])
        assert len(inc.failures) == 1


class TestIncidentReport:
    def test_create(self):
        report = IncidentReport(
            summary="Test summary",
            root_cause_analysis="RCA text",
            blast_radius_description="Blast text",
            severity_justification="Sev text",
            recommendations=["Fix A", "Fix B"],
        )
        assert report.summary == "Test summary"
        assert len(report.recommendations) == 2
        assert isinstance(report.generated_at, datetime)

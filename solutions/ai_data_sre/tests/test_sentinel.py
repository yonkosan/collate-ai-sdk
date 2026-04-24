# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""Unit tests for the Sentinel agent — uses mocked HTTP responses."""

from unittest.mock import MagicMock, patch

import pytest

from core.models import Incident, IncidentStatus, Severity
from core.sentinel import Sentinel, _PIPELINE_DEPTH


@pytest.fixture
def config():
    cfg = MagicMock()
    cfg.openmetadata_host = "http://localhost:8585"
    cfg.openmetadata_token = "test-token"
    cfg.api_headers = {
        "Authorization": "Bearer test-token",
        "Content-Type": "application/json",
    }
    return cfg


@pytest.fixture
def sentinel(config):
    with patch("core.sentinel.httpx.Client") as mock_client_cls:
        s = Sentinel(config)
        yield s, mock_client_cls.return_value
        s.close()


def _make_test_case(name, table_fqn, status="Failed", result_msg="Bad data"):
    return {
        "id": f"id-{name}",
        "name": name,
        "fullyQualifiedName": f"{table_fqn}.col.{name}",
        "testDefinition": {"name": "columnValuesToBeBetween"},
        "testCaseResult": {
            "testCaseStatus": status,
            "result": result_msg,
        },
    }


class TestSentinelScan:
    def test_no_failures_returns_empty(self, sentinel):
        s, mock_client = sentinel
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {"data": []}
        mock_client.get.return_value = resp

        incidents = s.scan()
        assert incidents == []

    def test_detects_single_failure(self, sentinel):
        s, mock_client = sentinel
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "data": [
                _make_test_case(
                    "order_date_range",
                    "svc.db.schema.raw_orders",
                    result_msg="847 rows outside range",
                )
            ]
        }
        mock_client.get.return_value = resp

        incidents = s.scan()
        assert len(incidents) == 1
        assert incidents[0].status == IncidentStatus.DETECTED
        assert len(incidents[0].failures) == 1

    def test_groups_by_table(self, sentinel):
        s, mock_client = sentinel
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "data": [
                _make_test_case("test1", "svc.db.schema.orders"),
                _make_test_case("test2", "svc.db.schema.orders"),
                _make_test_case("test3", "svc.db.schema.kpis"),
            ]
        }
        mock_client.get.return_value = resp

        incidents = s.scan()
        assert len(incidents) == 2  # 2 tables
        fqns = {inc.failures[0].table_fqn for inc in incidents}
        assert "svc.db.schema.orders" in fqns
        assert "svc.db.schema.kpis" in fqns

    def test_api_error_returns_empty(self, sentinel):
        s, mock_client = sentinel
        resp = MagicMock()
        resp.status_code = 500
        mock_client.get.return_value = resp

        incidents = s.scan()
        assert incidents == []

    def test_skips_non_failed_results(self, sentinel):
        s, mock_client = sentinel
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "data": [
                _make_test_case("pass_test", "svc.db.schema.t", status="Success"),
            ]
        }
        mock_client.get.return_value = resp

        incidents = s.scan()
        assert incidents == []


class TestSeverityAssessment:
    def test_raw_table_single_failure_is_medium(self):
        sev = Sentinel._assess_severity(
            [MagicMock()], depth=0  # raw layer, 1 failure
        )
        assert sev == Severity.MEDIUM

    def test_staging_table_is_high(self):
        sev = Sentinel._assess_severity([MagicMock()], depth=1)
        assert sev == Severity.HIGH

    def test_downstream_table_is_critical(self):
        sev = Sentinel._assess_severity([MagicMock()], depth=2)
        assert sev == Severity.CRITICAL

    def test_multiple_failures_escalates(self):
        sev = Sentinel._assess_severity(
            [MagicMock(), MagicMock(), MagicMock()], depth=0
        )
        assert sev == Severity.CRITICAL

    def test_two_failures_at_raw_is_high(self):
        sev = Sentinel._assess_severity([MagicMock(), MagicMock()], depth=0)
        assert sev == Severity.HIGH


class TestPipelineDepth:
    def test_raw_tables_are_depth_zero(self):
        assert _PIPELINE_DEPTH["raw_orders"] == 0
        assert _PIPELINE_DEPTH["raw_products"] == 0
        assert _PIPELINE_DEPTH["raw_suppliers"] == 0

    def test_staging_tables_are_depth_one(self):
        assert _PIPELINE_DEPTH["staging_orders"] == 1

    def test_exec_dashboard_is_deepest(self):
        assert _PIPELINE_DEPTH["exec_dashboard_kpis"] == 3

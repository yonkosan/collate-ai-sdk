# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""Unit tests for the Investigator agent — uses mocked lineage responses."""

from unittest.mock import MagicMock, patch

import pytest

from core.models import (
    AffectedAsset,
    BlastRadius,
    Incident,
    IncidentStatus,
    Severity,
    TestFailure,
)
from core.investigator import Investigator


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
def investigator(config):
    with patch("core.investigator.httpx.Client") as mock_client_cls:
        inv = Investigator(config)
        yield inv, mock_client_cls.return_value
        inv.close()


def _make_incident(table_fqn="svc.db.schema.staging_orders", severity=Severity.HIGH):
    return Incident(
        title=f"DQ failures on {table_fqn.rsplit('.', 1)[-1]}",
        severity=severity,
        failures=[
            TestFailure(
                test_case_id="tc-1",
                test_case_name="test_negative_prices",
                table_fqn=table_fqn,
                column="total_price",
                test_definition="columnValuesToBeNotNull",
                result_message="847 rows with negative values",
            )
        ],
    )


def _lineage_response(entity_id, entity_fqn, entity_name, upstream_edges, downstream_edges, nodes):
    return {
        "entity": {
            "id": entity_id,
            "name": entity_name,
            "fullyQualifiedName": entity_fqn,
        },
        "nodes": nodes,
        "upstreamEdges": upstream_edges,
        "downstreamEdges": downstream_edges,
    }


class TestInvestigatorInvestigate:
    def test_no_failures_returns_unchanged(self, investigator):
        inv, mock_client = investigator
        incident = Incident(title="Empty incident", failures=[])

        result = inv.investigate(incident)
        assert result.blast_radius is None
        assert result.status == IncidentStatus.INVESTIGATING

    def test_traces_upstream_root_cause(self, investigator):
        inv, mock_client = investigator
        incident = _make_incident("svc.db.schema.staging_orders")

        # First call: lineage for staging_orders (has upstream to raw_orders)
        staging_lineage = _lineage_response(
            entity_id="id-staging",
            entity_fqn="svc.db.schema.staging_orders",
            entity_name="staging_orders",
            upstream_edges=[
                {"fromEntity": "id-raw-orders", "toEntity": "id-staging"},
                {"fromEntity": "id-raw-products", "toEntity": "id-staging"},
            ],
            downstream_edges=[
                {"fromEntity": "id-staging", "toEntity": "id-fact"},
            ],
            nodes=[
                {"id": "id-raw-orders", "name": "raw_orders", "fullyQualifiedName": "svc.db.schema.raw_orders"},
                {"id": "id-raw-products", "name": "raw_products", "fullyQualifiedName": "svc.db.schema.raw_products"},
                {"id": "id-fact", "name": "fact_order_metrics", "fullyQualifiedName": "svc.db.schema.fact_order_metrics"},
            ],
        )

        # Second call: lineage for root cause (raw_orders — downstream only)
        root_lineage = _lineage_response(
            entity_id="id-raw-orders",
            entity_fqn="svc.db.schema.raw_orders",
            entity_name="raw_orders",
            upstream_edges=[],
            downstream_edges=[
                {"fromEntity": "id-raw-orders", "toEntity": "id-staging"},
            ],
            nodes=[
                {"id": "id-staging", "name": "staging_orders", "fullyQualifiedName": "svc.db.schema.staging_orders"},
            ],
        )

        resp1 = MagicMock()
        resp1.status_code = 200
        resp1.json.return_value = staging_lineage

        resp2 = MagicMock()
        resp2.status_code = 200
        resp2.json.return_value = root_lineage

        mock_client.get.side_effect = [resp1, resp2]

        result = inv.investigate(incident)
        assert result.blast_radius is not None
        # Root cause should be one of the upstream raw tables
        root = result.blast_radius.root_cause_table
        assert "raw_orders" in root or "raw_products" in root

    def test_no_lineage_returns_no_blast_radius(self, investigator):
        inv, mock_client = investigator
        incident = _make_incident()

        resp = MagicMock()
        resp.status_code = 404
        mock_client.get.return_value = resp

        result = inv.investigate(incident)
        assert result.blast_radius is None

    def test_status_transitions_to_investigating(self, investigator):
        inv, mock_client = investigator
        incident = _make_incident()

        resp = MagicMock()
        resp.status_code = 404
        mock_client.get.return_value = resp

        result = inv.investigate(incident)
        assert result.status == IncidentStatus.INVESTIGATING


class TestReassessSeverity:
    def test_large_blast_radius_is_critical(self):
        incident = _make_incident(severity=Severity.MEDIUM)
        incident.blast_radius = BlastRadius(
            root_cause_table="svc.db.schema.raw_orders",
            total_affected_assets=7,
        )
        sev = Investigator._reassess_severity(incident)
        assert sev == Severity.CRITICAL

    def test_medium_blast_radius_is_high(self):
        incident = _make_incident(severity=Severity.MEDIUM)
        incident.blast_radius = BlastRadius(
            root_cause_table="svc.db.schema.raw_orders",
            total_affected_assets=3,
        )
        sev = Investigator._reassess_severity(incident)
        assert sev == Severity.HIGH

    def test_small_blast_radius_is_medium(self):
        incident = _make_incident(severity=Severity.LOW)
        incident.blast_radius = BlastRadius(
            root_cause_table="svc.db.schema.raw_orders",
            total_affected_assets=2,
        )
        sev = Investigator._reassess_severity(incident)
        assert sev == Severity.MEDIUM

    def test_no_blast_radius_keeps_existing(self):
        incident = _make_incident(severity=Severity.HIGH)
        incident.blast_radius = None
        sev = Investigator._reassess_severity(incident)
        assert sev == Severity.HIGH

    def test_tiny_blast_radius_keeps_existing(self):
        incident = _make_incident(severity=Severity.MEDIUM)
        incident.blast_radius = BlastRadius(
            root_cause_table="svc.db.schema.raw_orders",
            total_affected_assets=1,
        )
        sev = Investigator._reassess_severity(incident)
        assert sev == Severity.MEDIUM

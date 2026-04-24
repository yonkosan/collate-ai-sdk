# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""Unit tests for the Narrator agent — uses mocked OpenAI responses."""

import json
from unittest.mock import MagicMock, patch

import pytest

from core.models import (
    AffectedAsset,
    BlastRadius,
    Incident,
    IncidentReport,
    IncidentStatus,
    Severity,
    TestFailure,
)
from core.narrator import Narrator


@pytest.fixture
def config():
    cfg = MagicMock()
    cfg.openai_api_key = "sk-test-key"
    return cfg


def _make_investigated_incident():
    incident = Incident(
        title="DQ failures on staging_orders (1 tests failed)",
        severity=Severity.CRITICAL,
        status=IncidentStatus.INVESTIGATING,
        failures=[
            TestFailure(
                test_case_id="tc-1",
                test_case_name="negative_price_check",
                table_fqn="svc.db.schema.staging_orders",
                column="total_price",
                test_definition="columnValuesToBeNotNull",
                result_message="847 rows with negative total_price",
            )
        ],
        blast_radius=BlastRadius(
            root_cause_table="svc.db.schema.raw_orders",
            root_cause_column="order_date",
            upstream_chain=[
                AffectedAsset(fqn="svc.db.schema.raw_orders", entity_type="table", depth=1),
                AffectedAsset(fqn="svc.db.schema.raw_products", entity_type="table", depth=1),
            ],
            downstream_impact=[
                AffectedAsset(fqn="svc.db.schema.fact_order_metrics", entity_type="table", depth=1),
                AffectedAsset(fqn="svc.db.schema.exec_dashboard_kpis", entity_type="table", depth=2),
            ],
            total_affected_assets=6,
        ),
    )
    return incident


class TestNarratorNarrate:
    @patch("core.narrator.openai.OpenAI")
    def test_generates_report_from_llm(self, mock_openai_cls, config):
        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client

        llm_response = {
            "summary": "Critical pricing issue detected.",
            "root_cause_analysis": "Future dates in raw_orders caused negative prices.",
            "blast_radius_description": "6 assets affected from raw to executive dashboard.",
            "severity_justification": "Critical due to executive dashboard impact.",
            "recommendations": ["Fix order dates", "Add date validation"],
        }

        mock_choice = MagicMock()
        mock_choice.message.content = json.dumps(llm_response)
        mock_completion = MagicMock()
        mock_completion.choices = [mock_choice]
        mock_client.chat.completions.create.return_value = mock_completion

        narrator = Narrator(config)
        incident = _make_investigated_incident()

        result = narrator.narrate(incident)
        assert result.report is not None
        assert result.report.summary == "Critical pricing issue detected."
        assert len(result.report.recommendations) == 2
        assert result.status == IncidentStatus.REPORTED

    @patch("core.narrator.openai.OpenAI")
    def test_fallback_on_llm_error(self, mock_openai_cls, config):
        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client
        mock_client.chat.completions.create.side_effect = Exception("API down")

        narrator = Narrator(config)
        incident = _make_investigated_incident()

        result = narrator.narrate(incident)
        assert result.report is not None
        assert "6 assets" in result.report.summary
        assert result.status == IncidentStatus.REPORTED

    @patch("core.narrator.openai.OpenAI")
    def test_skips_without_blast_radius(self, mock_openai_cls, config):
        mock_openai_cls.return_value = MagicMock()

        narrator = Narrator(config)
        incident = Incident(
            title="No blast radius incident",
            severity=Severity.MEDIUM,
            blast_radius=None,
        )

        result = narrator.narrate(incident)
        assert result.report is None


class TestFallbackReport:
    def test_contains_root_cause(self):
        incident = _make_investigated_incident()
        report = Narrator._fallback_report(incident)
        assert "raw_orders" in report.root_cause_analysis
        assert "6" in report.blast_radius_description

    def test_has_recommendations(self):
        incident = _make_investigated_incident()
        report = Narrator._fallback_report(incident)
        assert len(report.recommendations) == 3

    def test_without_blast_radius(self):
        incident = Incident(
            title="test",
            severity=Severity.LOW,
            blast_radius=None,
        )
        report = Narrator._fallback_report(incident)
        assert "Unknown" in report.root_cause_analysis


class TestBuildPrompt:
    @patch("core.narrator.openai.OpenAI")
    def test_prompt_includes_incident_data(self, mock_openai_cls, config):
        mock_openai_cls.return_value = MagicMock()
        narrator = Narrator(config)
        incident = _make_investigated_incident()

        prompt = narrator._build_prompt(incident)
        assert "staging_orders" in prompt
        assert "CRITICAL" in prompt
        assert "raw_orders" in prompt
        assert "order_date" in prompt
        assert "847 rows" in prompt

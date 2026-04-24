# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""Narrator agent — generates human-readable incident reports using GPT-4o-mini.

The Narrator takes the Investigator's findings and produces:
  1. A concise incident summary
  2. Root cause analysis narrative
  3. Blast radius description with affected stakeholders
  4. Severity justification
  5. Actionable remediation recommendations

Usage:
    from core.narrator import Narrator
    narrator = Narrator(config)
    narrator.narrate(incident)
"""

from __future__ import annotations

import json
from typing import List

import openai
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel

from core.config import DataPulseConfig
from core.models import Incident, IncidentReport, IncidentStatus

console = Console()

_SYSTEM_PROMPT = """\
You are DataPulse Narrator, an expert data incident analyst. Given structured
incident data (test failures, lineage-based blast radius, severity, ownership,
data tiers, and failure history), produce a crisp, actionable incident report
in JSON format.

Respond ONLY with valid JSON matching this schema:
{
  "summary": "One-paragraph executive summary",
  "root_cause_analysis": "Detailed RCA with specific tables, columns, and data issues",
  "blast_radius_description": "Which assets are affected and how the corruption propagates",
  "severity_justification": "Why this severity level is appropriate",
  "recommendations": ["Action 1", "Action 2", ...],
  "stakeholders_affected": "Which teams/owners are impacted",
  "trend_analysis": "Is this a new issue or recurring? Based on failure history"
}

Guidelines:
- Be specific: reference actual table names, column names, and row counts
- Explain the propagation path from root cause to downstream impact
- Mention affected data owners and tiers — Tier 1 assets are business-critical
- If failure history shows recurring patterns, highlight this urgently
- Recommendations should be concrete and ordered by priority
- Include recommended assignee based on table ownership
- Keep the summary under 100 words
- Use plain language, avoid jargon
"""


class Narrator:
    """Generates human-readable incident reports using OpenAI."""

    def __init__(self, config: DataPulseConfig) -> None:
        self._config = config
        self._openai = openai.OpenAI(api_key=config.openai_api_key)

    def narrate(self, incident: Incident) -> Incident:
        """Generate a narrative report for an investigated incident."""
        console.print(
            f"\n[bold cyan]📝 Narrator generating report for {incident.id}[/]…"
        )

        if not incident.blast_radius:
            console.print("  [yellow]No blast radius data — skipping narration[/]")
            return incident

        prompt = self._build_prompt(incident)

        try:
            report = self._call_llm(prompt)
            incident.report = report
            incident.transition(IncidentStatus.REPORTED)
            self._print_report(incident)
        except Exception as exc:
            console.print(f"  [red]LLM error: {exc}[/]")
            incident.report = self._fallback_report(incident)
            incident.transition(IncidentStatus.REPORTED)

        return incident

    def _build_prompt(self, incident: Incident) -> str:
        """Build the user prompt from incident data."""
        br = incident.blast_radius
        failures_text = "\n".join(
            f"  - {f.test_case_name} on {f.table_fqn}"
            f" (column: {f.column or 'N/A'}): {f.result_message}"
            for f in incident.failures
        )

        # Failure history trend
        history_text = "No history available."
        if incident.failure_histories:
            history_lines = []
            for h in incident.failure_histories:
                trend = " ".join(
                    "✓" if r.status == "Success" else "✗" for r in h.results
                )
                history_lines.append(
                    f"  - {h.test_case_name}: {trend} "
                    f"({h.failure_count}/{h.total_runs} failures, "
                    f"recurring={h.is_recurring})"
                )
            history_text = "\n".join(history_lines)

        upstream_text = "None"
        downstream_text = "None"
        owners_text = "Unknown"
        if br:
            if br.upstream_chain:
                upstream_text = " → ".join(
                    f"{a.fqn.rsplit('.', 1)[-1]} [tier={a.tier or 'unset'}, owners={a.owners or 'none'}]"
                    for a in br.upstream_chain
                )
            if br.downstream_impact:
                downstream_text = ", ".join(
                    f"{a.fqn.rsplit('.', 1)[-1]} [tier={a.tier or 'unset'}, owners={a.owners or 'none'}]"
                    for a in br.downstream_impact
                )
            all_owners = set()
            for a in br.upstream_chain + br.downstream_impact:
                all_owners.update(a.owners)
            if all_owners:
                owners_text = ", ".join(sorted(all_owners))

        return f"""\
Incident ID: {incident.id}
Title: {incident.title}
Current Severity: {incident.severity.name}
Status: {incident.status.value}

Failed Test Cases:
{failures_text}

Failure History (oldest → newest):
{history_text}

Blast Radius:
  Root cause table: {br.root_cause_table if br else 'Unknown'}
  Root cause column: {br.root_cause_column if br else 'Unknown'}
  Upstream chain: {upstream_text}
  Downstream impact: {downstream_text}
  Total affected assets: {br.total_affected_assets if br else 0}
  Affected data owners: {owners_text}

Generate the incident report JSON."""

    def _call_llm(self, prompt: str) -> IncidentReport:
        """Call GPT-4o-mini and parse the response into an IncidentReport."""
        response = self._openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=1000,
            response_format={"type": "json_object"},
        )

        content = response.choices[0].message.content or "{}"
        data = json.loads(content)

        return IncidentReport(
            summary=data.get("summary", "No summary generated."),
            root_cause_analysis=data.get("root_cause_analysis", ""),
            blast_radius_description=data.get("blast_radius_description", ""),
            severity_justification=data.get("severity_justification", ""),
            recommendations=data.get("recommendations", []),
            stakeholders_affected=data.get("stakeholders_affected", ""),
            trend_analysis=data.get("trend_analysis", ""),
        )

    @staticmethod
    def _fallback_report(incident: Incident) -> IncidentReport:
        """Generate a basic report when the LLM is unavailable."""
        br = incident.blast_radius
        root = br.root_cause_table if br else "Unknown"
        total = br.total_affected_assets if br else 0
        recs: List[str] = [
            f"Investigate data in {root} for anomalies",
            "Check upstream ETL jobs for errors",
            "Validate downstream dashboards for incorrect data",
        ]
        return IncidentReport(
            summary=f"Data quality incident affecting {total} assets. "
            f"Root cause traced to {root}.",
            root_cause_analysis=f"Failures detected on table(s) in the pipeline. "
            f"Root cause table: {root}.",
            blast_radius_description=f"{total} assets affected across the pipeline.",
            severity_justification=f"Severity {incident.severity.name} based on "
            f"blast radius of {total} assets.",
            recommendations=recs,
        )

    @staticmethod
    def _print_report(incident: Incident) -> None:
        """Pretty-print the incident report."""
        report = incident.report
        if not report:
            return

        console.print(
            Panel(
                Markdown(f"**Summary:** {report.summary}"),
                title=f"[bold]Incident {incident.id} — {incident.severity.name}[/]",
                border_style="red" if incident.severity.value <= 2 else "yellow",
            )
        )
        console.print(f"\n[bold]Root Cause Analysis:[/]\n{report.root_cause_analysis}\n")
        console.print(f"[bold]Blast Radius:[/]\n{report.blast_radius_description}\n")
        console.print(f"[bold]Severity Justification:[/]\n{report.severity_justification}\n")
        if report.recommendations:
            console.print("[bold]Recommendations:[/]")
            for i, rec in enumerate(report.recommendations, 1):
                console.print(f"  {i}. {rec}")


def main() -> None:
    """Run the Narrator standalone on test incidents."""
    from core.investigator import Investigator
    from core.sentinel import Sentinel

    config = DataPulseConfig.from_env()
    sentinel = Sentinel(config)
    investigator = Investigator(config)
    narrator = Narrator(config)
    try:
        incidents = sentinel.scan()
        for incident in incidents:
            investigator.investigate(incident)
            narrator.narrate(incident)
    finally:
        sentinel.close()
        investigator.close()


if __name__ == "__main__":
    main()

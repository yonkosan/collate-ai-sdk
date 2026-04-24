# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""Orchestrator — coordinates the Sentinel → Investigator → Narrator pipeline.

The Orchestrator is the top-level coordinator that:
  1. Runs the Sentinel to detect new failures
  2. Feeds incidents to the Investigator for RCA
  3. Passes investigation results to the Narrator for report generation
  4. Returns the fully enriched incident list

Usage:
    from core.orchestrator import Orchestrator
    orch = Orchestrator.from_env()
    incidents = orch.run_pipeline()
"""

from __future__ import annotations

from typing import List

from rich.console import Console
from rich.table import Table as RichTable

from core.config import DataPulseConfig
from core.investigator import Investigator
from core.models import Incident
from core.narrator import Narrator
from core.sentinel import Sentinel

console = Console()


class Orchestrator:
    """Runs the full DataPulse incident pipeline."""

    def __init__(self, config: DataPulseConfig) -> None:
        self._config = config
        self._sentinel = Sentinel(config)
        self._investigator = Investigator(config)
        self._narrator = Narrator(config)

    @classmethod
    def from_env(cls) -> Orchestrator:
        return cls(DataPulseConfig.from_env())

    def close(self) -> None:
        self._sentinel.close()
        self._investigator.close()

    def run_pipeline(self) -> List[Incident]:
        """Execute the full Sentinel → Investigator → Narrator pipeline."""
        console.rule("[bold cyan]DataPulse — AI-Powered Data Incident Command Center")

        # Phase 1: Detect
        incidents = self._sentinel.scan()
        if not incidents:
            console.print("[green]No incidents detected. All clear![/]")
            return []

        # Phase 2: Investigate
        for incident in incidents:
            self._investigator.investigate(incident)

        # Phase 3: Narrate
        for incident in incidents:
            self._narrator.narrate(incident)

        # Final summary
        self._print_dashboard(incidents)
        return incidents

    @staticmethod
    def _print_dashboard(incidents: List[Incident]) -> None:
        """Print a summary dashboard of all incidents."""
        console.rule("[bold]DataPulse — Incident Dashboard")

        table = RichTable(
            title="Active Incidents",
            show_lines=True,
        )
        table.add_column("ID", style="cyan", width=14)
        table.add_column("Severity", width=10)
        table.add_column("Title", width=40)
        table.add_column("Blast Radius", justify="right", width=14)
        table.add_column("Root Cause", width=30)
        table.add_column("Status", width=12)

        severity_colors = {
            "CRITICAL": "bold red",
            "HIGH": "red",
            "MEDIUM": "yellow",
            "LOW": "green",
            "INFO": "dim",
        }

        for inc in sorted(incidents, key=lambda i: i.severity.value):
            color = severity_colors.get(inc.severity.name, "white")
            br = inc.blast_radius
            root = br.root_cause_table.rsplit(".", 1)[-1] if br else "—"
            blast = str(br.total_affected_assets) if br else "—"

            table.add_row(
                inc.id,
                f"[{color}]{inc.severity.name}[/{color}]",
                inc.title,
                blast,
                root,
                inc.status.value,
            )

        console.print(table)
        console.print(
            f"\n[bold]Total:[/] {len(incidents)} incident(s) | "
            f"[red]{sum(1 for i in incidents if i.severity.value <= 2)} critical/high[/]\n"
        )


def main() -> None:
    """Run the full DataPulse pipeline."""
    orch = Orchestrator.from_env()
    try:
        orch.run_pipeline()
    finally:
        orch.close()


if __name__ == "__main__":
    main()

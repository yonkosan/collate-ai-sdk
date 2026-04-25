# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""Investigator agent — traces lineage to find root causes and map blast radius.

The Investigator takes incidents from the Sentinel and uses the
OpenMetadata lineage API to:
  1. Walk upstream lineage to find the root cause table/column
  2. Walk downstream lineage to map the full blast radius
  3. Identify affected owners and stakeholders
  4. Re-assess severity based on blast radius size

Usage:
    from core.investigator import Investigator
    investigator = Investigator(config)
    investigator.investigate(incident)
"""

from __future__ import annotations

from typing import Dict, List, Optional, Set, Tuple

import httpx
from rich.console import Console

from core.config import DataPulseConfig
from core.models import (
    AffectedAsset,
    BlastRadius,
    Incident,
    IncidentStatus,
    Severity,
)

console = Console()


class Investigator:
    """Traces lineage and maps blast radius for incidents."""

    def __init__(self, config: DataPulseConfig) -> None:
        self._config = config
        self._client = httpx.Client(
            base_url=config.openmetadata_host,
            headers=config.api_headers,
            timeout=30.0,
        )
        # Cache: entity_id → {name, fqn, type}
        self._node_cache: Dict[str, dict] = {}

    def close(self) -> None:
        self._client.close()

    def investigate(self, incident: Incident) -> Incident:
        """Run full investigation on an incident: lineage tracing + blast radius."""
        self._node_cache.clear()
        console.print(
            f"\n[bold cyan]🔎 Investigating incident {incident.id}[/]: {incident.title}"
        )
        incident.transition(IncidentStatus.INVESTIGATING)

        # Use the first failure's table as the starting point
        if not incident.failures:
            console.print("  [yellow]No failures to investigate[/]")
            return incident

        start_table_fqn = incident.failures[0].table_fqn
        start_column = incident.failures[0].column
        console.print(f"  Starting from: [white]{start_table_fqn}[/]")

        # Fetch lineage graph
        lineage = self._fetch_lineage(start_table_fqn)
        if not lineage:
            console.print("  [yellow]No lineage data available[/]")
            return incident

        # Build node lookup from lineage response
        self._build_node_cache(lineage)

        # Walk upstream to find ALL upstream nodes (full graph)
        entity_id = lineage.get("entity", {}).get("id", "")
        all_upstream = self._walk_upstream(lineage, entity_id)

        # Trace the failing column through column lineage to find the TRUE
        # root cause table and column — not just the last BFS node.
        fail_message = incident.failures[0].result_message or ""
        root_cause_fqn, root_cause_column = self._trace_root_cause(
            lineage, start_column, start_table_fqn, fail_message
        )

        # Build the path from start table to root cause using table-level edges,
        # so we only show relevant upstream tables (not unrelated branches).
        path_fqns = self._find_path_to_root(lineage, entity_id, root_cause_fqn)

        # Filter upstream chain to only tables on the path to the root cause,
        # and exclude both the start table and root cause (shown separately).
        upstream_chain = [
            a for a in all_upstream
            if a.fqn in path_fqns and a.fqn != root_cause_fqn
        ]

        # Walk downstream from root cause to find full impact
        root_lineage = self._fetch_lineage(root_cause_fqn)
        if root_lineage:
            self._build_node_cache(root_lineage)
            root_entity_id = root_lineage.get("entity", {}).get("id", "")
            downstream_impact = self._walk_downstream(root_lineage, root_entity_id)
        else:
            downstream_impact = []

        # Collect all affected owners
        all_assets = upstream_chain + downstream_impact
        owners: Set[str] = set()
        for asset in all_assets:
            owners.update(asset.owners)

        blast_radius = BlastRadius(
            root_cause_table=root_cause_fqn,
            root_cause_column=root_cause_column,
            upstream_chain=upstream_chain,
            downstream_impact=downstream_impact,
            total_affected_assets=len(all_assets) + 1,  # +1 for the incident table
            affected_owners=sorted(owners),
        )
        incident.blast_radius = blast_radius

        # Re-assess severity based on blast radius
        new_severity = self._reassess_severity(incident)
        if new_severity.value < incident.severity.value:
            console.print(
                f"  ⬆ Escalating severity: {incident.severity.name} → {new_severity.name}"
            )
            incident.escalate(new_severity)

        # Print investigation summary
        console.print(f"  Root cause: [red]{root_cause_fqn}[/]")
        if upstream_chain:
            chain_str = " → ".join(a.fqn.rsplit(".", 1)[-1] for a in upstream_chain)
            console.print(f"  Upstream chain: {chain_str}")
        console.print(f"  Downstream impact: [yellow]{len(downstream_impact)}[/] assets")
        console.print(f"  Total blast radius: [bold]{blast_radius.total_affected_assets}[/] assets")

        return incident

    def _fetch_lineage(self, table_fqn: str) -> Optional[dict]:
        """Fetch lineage graph for a table from OpenMetadata."""
        resp = self._client.get(
            f"/api/v1/lineage/table/name/{table_fqn}",
            params={"upstreamDepth": 3, "downstreamDepth": 3},
        )
        if resp.status_code != 200:
            console.print(f"  [yellow]Lineage API returned {resp.status_code}[/]")
            return None
        return resp.json()

    def _build_node_cache(self, lineage: dict) -> None:
        """Cache node metadata from lineage response."""
        entity = lineage.get("entity", {})
        if entity.get("id"):
            self._node_cache[entity["id"]] = {
                "name": entity.get("name", ""),
                "fqn": entity.get("fullyQualifiedName", ""),
                "type": "table",
                "description": entity.get("description", ""),
                "owners": [
                    o.get("displayName", o.get("name", ""))
                    for o in entity.get("owners", [])
                ],
                "tags": [
                    t.get("tagFQN", "")
                    for t in entity.get("tags", [])
                ],
            }
        for node in lineage.get("nodes", []):
            self._node_cache[node["id"]] = {
                "name": node.get("name", ""),
                "fqn": node.get("fullyQualifiedName", ""),
                "type": "table",
                "description": node.get("description", ""),
                "owners": [
                    o.get("displayName", o.get("name", ""))
                    for o in node.get("owners", [])
                ],
                "tags": [
                    t.get("tagFQN", "")
                    for t in node.get("tags", [])
                ],
            }

    def _walk_upstream(self, lineage: dict, entity_id: str) -> List[AffectedAsset]:
        """Walk upstream edges to find the root cause chain."""
        # Build adjacency: to_id → list of from_ids
        upstream_adj: Dict[str, List[str]] = {}
        for edge in lineage.get("upstreamEdges", []):
            to_id = edge["toEntity"]
            from_id = edge["fromEntity"]
            upstream_adj.setdefault(to_id, []).append(from_id)

        chain: List[AffectedAsset] = []
        visited: Set[str] = set()
        queue = [entity_id]
        depth = 0

        while queue:
            next_queue: List[str] = []
            for current_id in queue:
                if current_id in visited:
                    continue
                visited.add(current_id)

                parents = upstream_adj.get(current_id, [])
                for parent_id in parents:
                    if parent_id in visited:
                        continue
                    node = self._node_cache.get(parent_id, {})
                    tags = node.get("tags", [])
                    tier = next((t for t in tags if t.startswith("Tier.")), None)
                    chain.append(
                        AffectedAsset(
                            fqn=node.get("fqn", parent_id),
                            entity_type="table",
                            display_name=node.get("name", ""),
                            description=node.get("description", ""),
                            owners=node.get("owners", []),
                            tags=tags,
                            tier=tier,
                            depth=depth + 1,
                        )
                    )
                    next_queue.append(parent_id)

            queue = next_queue
            depth += 1

        return chain

    def _find_path_to_root(
        self, lineage: dict, start_id: str, root_cause_fqn: str
    ) -> Set[str]:
        """Find all table FQNs on the shortest path from start to root cause.

        Uses BFS with parent tracking to find the path through the upstream
        graph. Returns the set of FQNs on that path (excluding start table).
        If no path is found, returns all upstream FQNs as fallback.
        """
        # Build adjacency: child_id → [parent_ids]
        upstream_adj: Dict[str, List[str]] = {}
        for edge in lineage.get("upstreamEdges", []):
            to_id = edge["toEntity"]
            from_id = edge["fromEntity"]
            upstream_adj.setdefault(to_id, []).append(from_id)

        # Find root cause entity id
        root_id: Optional[str] = None
        for nid, ndata in self._node_cache.items():
            if ndata.get("fqn", "") == root_cause_fqn:
                root_id = nid
                break

        if not root_id:
            return {n.get("fqn", "") for n in self._node_cache.values()}

        # BFS from start to find root cause, tracking parents
        parent_map: Dict[str, Optional[str]] = {start_id: None}
        queue = [start_id]
        found = False
        while queue and not found:
            next_queue: List[str] = []
            for current_id in queue:
                for parent_id in upstream_adj.get(current_id, []):
                    if parent_id not in parent_map:
                        parent_map[parent_id] = current_id
                        if parent_id == root_id:
                            found = True
                            break
                        next_queue.append(parent_id)
                if found:
                    break
            queue = next_queue

        if not found:
            return {n.get("fqn", "") for n in self._node_cache.values()}

        # Walk back from root to start to collect path FQNs
        path_fqns: Set[str] = set()
        current: Optional[str] = root_id
        while current is not None:
            node = self._node_cache.get(current, {})
            fqn = node.get("fqn", "")
            if fqn:
                path_fqns.add(fqn)
            current = parent_map.get(current)

        return path_fqns

    def _trace_root_cause(
        self,
        lineage: dict,
        column_name: Optional[str],
        start_table_fqn: str,
        fail_message: str = "",
    ) -> Tuple[str, Optional[str]]:
        """Trace a column through column-level lineage to find both the root
        cause *table* and *column*.

        Returns ``(root_cause_table_fqn, root_cause_column_name)``.

        Walks ``columnsLineage`` metadata on upstream edges hop-by-hop until
        no further upstream mapping exists.  Then checks if the failure message
        references a deeper upstream table.column — which catches computed
        columns whose root cause is further upstream.
        """
        if not column_name:
            return start_table_fqn, None

        # Build a column-level reverse map: (to_entity_id, to_col_fqn) → from_col_fqn
        col_map: Dict[Tuple[str, str], str] = {}
        for edge in lineage.get("upstreamEdges", []):
            to_id = edge["toEntity"]
            details = edge.get("lineageDetails", {})
            for col_edge in details.get("columnsLineage", []):
                to_col = col_edge.get("toColumn", "")
                from_cols = col_edge.get("fromColumns", [])
                if not from_cols or not to_col:
                    continue
                col_map[(to_id, to_col)] = from_cols[0]

        # Build id ↔ fqn lookups
        entity_id = lineage.get("entity", {}).get("id", "")
        fqn_to_id: Dict[str, str] = {start_table_fqn: entity_id}
        id_to_fqn: Dict[str, str] = {entity_id: start_table_fqn}
        for nid, ndata in self._node_cache.items():
            fqn = ndata.get("fqn", "")
            fqn_to_id[fqn] = nid
            id_to_fqn[nid] = fqn

        # Walk upstream following column lineage hop by hop
        current_col_fqn = f"{start_table_fqn}.{column_name}"
        visited: Set[str] = set()
        current_id = entity_id
        while current_id and current_id not in visited:
            visited.add(current_id)
            key = (current_id, current_col_fqn)
            if key in col_map:
                current_col_fqn = col_map[key]
                parent_fqn = current_col_fqn.rsplit(".", 1)[0]
                current_id = fqn_to_id.get(parent_fqn)
            else:
                break

        # Split FQN into table + column
        parts = current_col_fqn.rsplit(".", 1)
        traced_table = parts[0] if len(parts) == 2 else start_table_fqn
        traced_col = parts[-1]

        # Check the failure message for a deeper root cause reference.
        # The message may say "raw_orders.order_date" even when column lineage
        # stopped at a mid-tier computed column.
        msg_lower = fail_message.lower()
        all_from_cols: List[str] = []
        for edge in lineage.get("upstreamEdges", []):
            details = edge.get("lineageDetails", {})
            for col_edge in details.get("columnsLineage", []):
                for fc in col_edge.get("fromColumns", []):
                    all_from_cols.append(fc)

        for fc in all_from_cols:
            fc_parts = fc.rsplit(".", 1)
            if len(fc_parts) != 2:
                continue
            fc_table_fqn = fc_parts[0]
            fc_col = fc_parts[1]
            fc_table_short = fc_table_fqn.rsplit(".", 1)[-1]
            if f"{fc_table_short}.{fc_col}".lower() in msg_lower:
                return fc_table_fqn, fc_col

        # If column traced beyond the start table, use that result
        if traced_table != start_table_fqn:
            return traced_table, traced_col

        # Last resort — walk all upstream and pick the deepest table
        all_upstream = self._walk_upstream(lineage, entity_id)
        if all_upstream:
            return all_upstream[-1].fqn, None
        return start_table_fqn, column_name

        # Last resort — walk all upstream and pick the deepest table-level root
        all_upstream = self._walk_upstream(lineage, entity_id)
        if all_upstream:
            deepest = all_upstream[-1]
            return deepest.fqn, None
        return start_table_fqn, column_name

    def _walk_downstream(self, lineage: dict, entity_id: str) -> List[AffectedAsset]:
        """Walk downstream edges to find all impacted assets."""
        downstream_adj: Dict[str, List[str]] = {}
        for edge in lineage.get("downstreamEdges", []):
            from_id = edge["fromEntity"]
            to_id = edge["toEntity"]
            downstream_adj.setdefault(from_id, []).append(to_id)

        impact: List[AffectedAsset] = []
        visited: Set[str] = set()
        queue = [entity_id]
        depth = 0

        while queue:
            next_queue: List[str] = []
            for current_id in queue:
                if current_id in visited:
                    continue
                visited.add(current_id)

                children = downstream_adj.get(current_id, [])
                for child_id in children:
                    if child_id in visited:
                        continue
                    node = self._node_cache.get(child_id, {})
                    tags = node.get("tags", [])
                    tier = next((t for t in tags if t.startswith("Tier.")), None)
                    impact.append(
                        AffectedAsset(
                            fqn=node.get("fqn", child_id),
                            entity_type="table",
                            display_name=node.get("name", ""),
                            description=node.get("description", ""),
                            owners=node.get("owners", []),
                            tags=tags,
                            tier=tier,
                            depth=depth + 1,
                        )
                    )
                    next_queue.append(child_id)

            queue = next_queue
            depth += 1

        return impact

    @staticmethod
    def _reassess_severity(incident: Incident) -> Severity:
        """Re-assess severity based on blast radius and tier of affected assets."""
        br = incident.blast_radius
        if not br:
            return incident.severity

        total = br.total_affected_assets

        # If any Tier 1 asset is in the blast radius, it's critical
        all_assets = br.upstream_chain + br.downstream_impact
        has_tier1 = any(a.tier == "Tier.Tier1" for a in all_assets)
        if has_tier1:
            return Severity.CRITICAL

        if total >= 5:
            return Severity.CRITICAL
        if total >= 3:
            return Severity.HIGH
        if total >= 2:
            return Severity.MEDIUM
        return incident.severity


def main() -> None:
    """Run the Investigator standalone on a test incident."""
    from core.sentinel import Sentinel

    config = DataPulseConfig.from_env()
    sentinel = Sentinel(config)
    investigator = Investigator(config)
    try:
        incidents = sentinel.scan()
        for incident in incidents:
            investigator.investigate(incident)
    finally:
        sentinel.close()
        investigator.close()


if __name__ == "__main__":
    main()

# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""Lineage graph visualization using streamlit-agraph."""

from __future__ import annotations

from typing import List, Optional, Set

from streamlit_agraph import Config, Edge, Node, agraph

from core.models import BlastRadius, Incident

# ─── Colour palette ────────────────────────────────────────────────────────────

_ROOT_CAUSE_COLOR = "#EF4444"  # red-500
_UPSTREAM_COLOR = "#F97316"    # orange-500
_DOWNSTREAM_COLOR = "#FBBF24"  # amber-400
_INCIDENT_TABLE_COLOR = "#DC2626"  # red-600
_HEALTHY_COLOR = "#6366F1"     # indigo-500
_EDGE_COLOR = "#94A3B8"        # slate-400
_EDGE_AFFECTED = "#EF4444"     # red-500

# Pipeline layers for y-positioning
_LAYER_ORDER = [
    "raw_orders", "raw_products", "raw_suppliers",
    "staging_orders", "staging_suppliers",
    "fact_order_metrics", "fact_supply_chain",
    "exec_dashboard_kpis",
]

_LAYER_Y = {name: idx * 120 for idx, name in enumerate(_LAYER_ORDER)}
_LAYER_X = {
    "raw_orders": 0, "raw_products": 300, "raw_suppliers": 600,
    "staging_orders": 150, "staging_suppliers": 600,
    "fact_order_metrics": 150, "fact_supply_chain": 600,
    "exec_dashboard_kpis": 375,
}


def render_lineage_graph(
    incident: Incident,
    height: int = 520,
) -> None:
    """Render an interactive lineage graph for a single incident."""
    br = incident.blast_radius
    if not br:
        return

    affected_fqns = _collect_affected_fqns(br, incident)
    root_short = br.root_cause_table.rsplit(".", 1)[-1]

    nodes: List[Node] = []
    edges: List[Edge] = []
    seen_nodes: Set[str] = set()

    # Add all pipeline tables as nodes
    for table_name in _LAYER_ORDER:
        if table_name in seen_nodes:
            continue
        seen_nodes.add(table_name)

        is_root = table_name == root_short
        is_affected = any(table_name in fqn for fqn in affected_fqns)
        is_incident = any(
            table_name in f.table_fqn for f in incident.failures
        )

        color, size, symbol = _node_style(is_root, is_incident, is_affected)

        nodes.append(
            Node(
                id=table_name,
                label=table_name.replace("_", " ").title(),
                size=size,
                color=color,
                shape="dot",
                font={"size": 14, "color": "#E2E8F0", "face": "Inter, sans-serif"},
                borderWidth=3 if is_root or is_incident else 1,
                borderWidthSelected=4,
                title=_tooltip(table_name, is_root, is_incident, is_affected),
                x=_LAYER_X.get(table_name, 300),
                y=_LAYER_Y.get(table_name, 0),
            )
        )

    # Add edges from the known pipeline
    pipeline_edges = [
        ("raw_orders", "staging_orders"),
        ("raw_products", "staging_orders"),
        ("raw_suppliers", "staging_suppliers"),
        ("staging_orders", "fact_order_metrics"),
        ("staging_suppliers", "fact_supply_chain"),
        ("fact_order_metrics", "exec_dashboard_kpis"),
        ("fact_supply_chain", "exec_dashboard_kpis"),
    ]

    for src, dst in pipeline_edges:
        is_affected_edge = any(
            src in fqn or dst in fqn for fqn in affected_fqns
        )
        edges.append(
            Edge(
                source=src,
                target=dst,
                color=_EDGE_AFFECTED if is_affected_edge else _EDGE_COLOR,
                width=3 if is_affected_edge else 1,
                type="CURVE_SMOOTH",
            )
        )

    config = Config(
        width="100%",
        height=height,
        directed=True,
        physics=False,
        hierarchical=False,
        nodeHighlightBehavior=True,
        highlightColor="#F1F5F9",
        collapsible=False,
        node={"highlightStrokeColor": "#3B82F6"},
        link={"highlightColor": "#3B82F6"},
    )

    agraph(nodes=nodes, edges=edges, config=config)


def _collect_affected_fqns(br: BlastRadius, incident: Incident) -> Set[str]:
    """Collect all FQNs touched by this incident."""
    fqns: Set[str] = set()
    fqns.add(br.root_cause_table)
    for a in br.upstream_chain:
        fqns.add(a.fqn)
    for a in br.downstream_impact:
        fqns.add(a.fqn)
    for f in incident.failures:
        fqns.add(f.table_fqn)
    return fqns


def _node_style(is_root: bool, is_incident: bool, is_affected: bool):
    """Return (color, size, symbol) for a node."""
    if is_root:
        return _ROOT_CAUSE_COLOR, 35, "star"
    if is_incident:
        return _INCIDENT_TABLE_COLOR, 30, "triangle"
    if is_affected:
        return _UPSTREAM_COLOR, 25, "dot"
    return _HEALTHY_COLOR, 20, "dot"


def _tooltip(name: str, is_root: bool, is_incident: bool, is_affected: bool) -> str:
    """Build hover tooltip text."""
    parts = [name.replace("_", " ").title()]
    if is_root:
        parts.append("⚠️ ROOT CAUSE")
    if is_incident:
        parts.append("🔴 DQ Failure detected here")
    if is_affected and not is_root:
        parts.append("🟠 In blast radius")
    return "\n".join(parts)

# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""DataPulse — AI-Powered Data Incident Command Center.

Run with:
    cd solutions/ai_data_sre
    streamlit run ui/app.py
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import List

import streamlit as st

# Ensure project root is on sys.path so core.* imports work
_PROJECT_ROOT = str(Path(__file__).resolve().parent.parent)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from core.models import Incident, Severity  # noqa: E402
from core.orchestrator import Orchestrator  # noqa: E402
from ui.components.incident_cards import (  # noqa: E402
    render_incident_card,
    render_metric_card,
    render_severity_badge,
)
from ui.components.lineage_graph import render_lineage_graph  # noqa: E402

# ─── Page config ────────────────────────────────────────────────────────────────

st.set_page_config(
    page_title="DataPulse — Incident Command Center",
    page_icon="🔴",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─── Custom CSS ─────────────────────────────────────────────────────────────────

st.markdown(
    """
    <style>
    /* Dark theme overrides */
    .stApp {
        background: linear-gradient(180deg, #0B1120 0%, #0F172A 100%);
    }
    /* Remove default padding */
    .block-container {
        padding-top: 2rem;
        padding-bottom: 1rem;
    }
    /* Header styling */
    .datapulse-header {
        background: linear-gradient(135deg, #1E293B 0%, #0F172A 100%);
        border-radius: 16px;
        padding: 28px 36px;
        margin-bottom: 24px;
        border: 1px solid #334155;
        box-shadow: 0 4px 24px rgba(0,0,0,0.3);
    }
    .datapulse-title {
        font-size: 36px;
        font-weight: 800;
        background: linear-gradient(135deg, #3B82F6, #8B5CF6);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        margin: 0;
    }
    .datapulse-subtitle {
        color: #94A3B8;
        font-size: 16px;
        margin-top: 4px;
    }
    /* Tabs */
    .stTabs [data-baseweb="tab-list"] {
        gap: 8px;
    }
    .stTabs [data-baseweb="tab"] {
        background: #1E293B;
        border-radius: 8px;
        padding: 8px 20px;
        color: #94A3B8;
        border: 1px solid #334155;
    }
    .stTabs [aria-selected="true"] {
        background: #3B82F6 !important;
        color: white !important;
    }
    /* Expander */
    .streamlit-expanderHeader {
        background: #1E293B;
        border-radius: 8px;
        color: #E2E8F0;
    }
    /* Sidebar */
    [data-testid="stSidebar"] {
        background: #0F172A;
        border-right: 1px solid #1E293B;
    }
    </style>
    """,
    unsafe_allow_html=True,
)

# ─── Session state ──────────────────────────────────────────────────────────────

if "incidents" not in st.session_state:
    st.session_state.incidents = []
if "pipeline_ran" not in st.session_state:
    st.session_state.pipeline_ran = False


def _run_pipeline() -> List[Incident]:
    """Execute the full DataPulse pipeline."""
    orch = Orchestrator.from_env()
    try:
        return orch.run_pipeline()
    finally:
        orch.close()


# ─── Sidebar ────────────────────────────────────────────────────────────────────

with st.sidebar:
    st.markdown(
        """
        <div style="text-align:center;padding:16px 0;">
            <div style="font-size:48px;">🔴</div>
            <div style="font-size:22px;font-weight:700;color:#F1F5F9;
                        margin-top:8px;">DataPulse</div>
            <div style="color:#64748B;font-size:13px;">AI Incident Command Center</div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    st.divider()

    st.markdown("### 🚀 Pipeline Control")
    if st.button("▶ Run Full Pipeline", type="primary", use_container_width=True):
        with st.spinner("Running Sentinel → Investigator → Narrator…"):
            incidents = _run_pipeline()
            st.session_state.incidents = incidents
            st.session_state.pipeline_ran = True
        st.rerun()

    if st.session_state.pipeline_ran:
        inc_list = st.session_state.incidents
        st.success(f"✅ {len(inc_list)} incident(s) detected")

        st.divider()
        st.markdown("### 📊 Quick Stats")
        total = len(inc_list)
        critical = sum(1 for i in inc_list if i.severity == Severity.CRITICAL)
        high = sum(1 for i in inc_list if i.severity == Severity.HIGH)
        max_blast = max((i.blast_radius.total_affected_assets for i in inc_list if i.blast_radius), default=0)

        st.metric("Total Incidents", total)
        st.metric("Critical / High", f"{critical} / {high}")
        st.metric("Max Blast Radius", f"{max_blast} assets")

    st.divider()
    st.markdown(
        """
        <div style="color:#475569;font-size:12px;padding:8px;">
            <strong>Pipeline:</strong> Sentinel → Investigator → Narrator<br>
            <strong>Source:</strong> OpenMetadata DQ API<br>
            <strong>AI Model:</strong> GPT-4o-mini<br>
            <strong>Version:</strong> 1.0.0
        </div>
        """,
        unsafe_allow_html=True,
    )

# ─── Main content ──────────────────────────────────────────────────────────────

# Header
st.markdown(
    """
    <div class="datapulse-header">
        <h1 class="datapulse-title">DataPulse</h1>
        <div class="datapulse-subtitle">
            AI-Powered Data Incident Command Center — Detect · Investigate · Report
        </div>
    </div>
    """,
    unsafe_allow_html=True,
)

incidents: List[Incident] = st.session_state.incidents

if not incidents:
    # Empty state
    st.markdown(
        """
        <div style="text-align:center;padding:80px 20px;">
            <div style="font-size:72px;margin-bottom:16px;">🛡️</div>
            <div style="font-size:24px;color:#E2E8F0;font-weight:600;">
                No incidents detected yet
            </div>
            <div style="color:#64748B;font-size:16px;margin-top:8px;">
                Click <strong>▶ Run Full Pipeline</strong> in the sidebar to start scanning
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    st.stop()

# ─── KPI row ────────────────────────────────────────────────────────────────────

sorted_incidents = sorted(incidents, key=lambda i: i.severity.value)
critical_count = sum(1 for i in incidents if i.severity == Severity.CRITICAL)
high_count = sum(1 for i in incidents if i.severity == Severity.HIGH)
total_blast = sum(
    i.blast_radius.total_affected_assets for i in incidents if i.blast_radius
)
tables_affected = len(
    {f.table_fqn for i in incidents for f in i.failures}
)

k1, k2, k3, k4 = st.columns(4)
with k1:
    render_metric_card("Total Incidents", str(len(incidents)), "#3B82F6")
with k2:
    render_metric_card("Critical / High", f"{critical_count} / {high_count}", "#EF4444")
with k3:
    render_metric_card("Total Blast Radius", str(total_blast), "#F97316")
with k4:
    render_metric_card("Tables Affected", str(tables_affected), "#8B5CF6")

st.markdown("<br>", unsafe_allow_html=True)

# ─── Tabs ───────────────────────────────────────────────────────────────────────

tab_dashboard, tab_lineage, tab_reports = st.tabs([
    "📋 Incident Dashboard",
    "🔗 Blast Radius Graph",
    "📄 Full Reports",
])

# ── Tab 1: Dashboard ────────────────────────────────────────────────────────────

with tab_dashboard:
    st.markdown("### Active Incidents")
    st.markdown(
        "<div style='color:#94A3B8;margin-bottom:16px;'>Sorted by severity — "
        "most critical first</div>",
        unsafe_allow_html=True,
    )

    for idx, inc in enumerate(sorted_incidents):
        render_incident_card(inc, idx)
        st.markdown("<div style='height:8px;'></div>", unsafe_allow_html=True)

# ── Tab 2: Lineage Graph ────────────────────────────────────────────────────────

with tab_lineage:
    st.markdown("### Blast Radius Visualization")
    st.markdown(
        "<div style='color:#94A3B8;margin-bottom:16px;'>"
        "Interactive lineage graph — "
        "<span style='color:#EF4444;'>●</span> Root cause · "
        "<span style='color:#F97316;'>●</span> Affected · "
        "<span style='color:#6366F1;'>●</span> Healthy"
        "</div>",
        unsafe_allow_html=True,
    )

    # Let user pick which incident to visualize
    incident_options = {
        f"INC-{inc.id[:8].upper()} — {inc.severity.name} — {inc.title}": inc
        for inc in sorted_incidents
    }

    selected_label = st.selectbox(
        "Select incident to visualize",
        options=list(incident_options.keys()),
        label_visibility="collapsed",
    )

    if selected_label:
        selected_incident = incident_options[selected_label]
        render_lineage_graph(selected_incident, height=520)

        # Show blast radius details below
        br = selected_incident.blast_radius
        if br:
            c1, c2, c3 = st.columns(3)
            with c1:
                root_short = br.root_cause_table.rsplit(".", 1)[-1]
                st.markdown(
                    f"""<div style="background:#7F1D1D;border-radius:8px;padding:16px;
                                text-align:center;">
                        <div style="color:#FCA5A5;font-size:12px;">ROOT CAUSE</div>
                        <div style="color:#FEE2E2;font-size:20px;font-weight:700;">
                            {root_short}
                        </div>
                    </div>""",
                    unsafe_allow_html=True,
                )
            with c2:
                upstream_names = [a.fqn.rsplit(".", 1)[-1] for a in br.upstream_chain]
                st.markdown(
                    f"""<div style="background:#7C2D12;border-radius:8px;padding:16px;
                                text-align:center;">
                        <div style="color:#FDBA74;font-size:12px;">UPSTREAM CHAIN</div>
                        <div style="color:#FED7AA;font-size:14px;font-weight:600;">
                            {' → '.join(upstream_names) if upstream_names else '—'}
                        </div>
                    </div>""",
                    unsafe_allow_html=True,
                )
            with c3:
                downstream_names = [a.fqn.rsplit(".", 1)[-1] for a in br.downstream_impact]
                st.markdown(
                    f"""<div style="background:#713F12;border-radius:8px;padding:16px;
                                text-align:center;">
                        <div style="color:#FDE68A;font-size:12px;">DOWNSTREAM IMPACT</div>
                        <div style="color:#FEF3C7;font-size:14px;font-weight:600;">
                            {', '.join(downstream_names) if downstream_names else '—'}
                        </div>
                    </div>""",
                    unsafe_allow_html=True,
                )

# ── Tab 3: Full Reports ─────────────────────────────────────────────────────────

with tab_reports:
    st.markdown("### AI-Generated Incident Reports")
    st.markdown(
        "<div style='color:#94A3B8;margin-bottom:16px;'>"
        "Detailed analysis generated by GPT-4o-mini with root cause analysis, "
        "blast radius mapping, and actionable recommendations"
        "</div>",
        unsafe_allow_html=True,
    )

    for inc in sorted_incidents:
        report = inc.report
        if not report:
            continue

        sev_badge = render_severity_badge(inc.severity)
        st.markdown(
            f"""
            <div style="background:#1E293B;border-radius:12px;padding:24px;
                        margin-bottom:16px;border:1px solid #334155;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="color:#94A3B8;font-family:monospace;">
                        INC-{inc.id[:8].upper()}
                    </span>
                    {sev_badge}
                </div>
                <h3 style="color:#F1F5F9;margin-top:12px;">{inc.title}</h3>
            </div>
            """,
            unsafe_allow_html=True,
        )

        with st.expander("📝 Full Report", expanded=True):
            st.markdown(f"**Summary:** {report.summary}")
            st.divider()

            r1, r2 = st.columns(2)
            with r1:
                st.markdown("**🔍 Root Cause Analysis**")
                st.markdown(report.root_cause_analysis)
            with r2:
                st.markdown("**💥 Blast Radius**")
                st.markdown(report.blast_radius_description)

            st.divider()
            st.markdown(f"**⚖️ Severity Justification:** {report.severity_justification}")

            if report.recommendations:
                st.markdown("**✅ Recommendations:**")
                for i, rec in enumerate(report.recommendations, 1):
                    st.markdown(f"{i}. {rec}")

        st.markdown("<br>", unsafe_allow_html=True)

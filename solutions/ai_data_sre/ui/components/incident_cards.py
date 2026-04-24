# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""Incident card components for the Streamlit dashboard."""

from __future__ import annotations

import streamlit as st

from core.models import Incident, Severity

# ─── Severity styling ──────────────────────────────────────────────────────────

_SEV_CONFIG = {
    Severity.CRITICAL: {"emoji": "🔴", "color": "#EF4444", "bg": "#7F1D1D", "label": "CRITICAL"},
    Severity.HIGH:     {"emoji": "🟠", "color": "#F97316", "bg": "#7C2D12", "label": "HIGH"},
    Severity.MEDIUM:   {"emoji": "🟡", "color": "#EAB308", "bg": "#713F12", "label": "MEDIUM"},
    Severity.LOW:      {"emoji": "🟢", "color": "#22C55E", "bg": "#14532D", "label": "LOW"},
    Severity.INFO:     {"emoji": "🔵", "color": "#3B82F6", "bg": "#1E3A5F", "label": "INFO"},
}


def render_severity_badge(severity: Severity) -> str:
    """Return an HTML severity badge."""
    cfg = _SEV_CONFIG.get(severity, _SEV_CONFIG[Severity.MEDIUM])
    return (
        f'<span style="background:{cfg["bg"]};color:{cfg["color"]};'
        f'padding:4px 12px;border-radius:20px;font-weight:700;font-size:13px;'
        f'border:1px solid {cfg["color"]};">'
        f'{cfg["emoji"]} {cfg["label"]}</span>'
    )


def render_metric_card(label: str, value: str, color: str = "#E2E8F0") -> None:
    """Render a single KPI metric card."""
    st.markdown(
        f"""
        <div style="background:#1E293B;border-radius:12px;padding:20px 24px;
                    text-align:center;border:1px solid #334155;">
            <div style="color:#94A3B8;font-size:13px;text-transform:uppercase;
                        letter-spacing:1px;margin-bottom:6px;">{label}</div>
            <div style="color:{color};font-size:32px;font-weight:800;">{value}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_incident_card(incident: Incident, idx: int) -> None:
    """Render a full expandable incident card."""
    sev = _SEV_CONFIG.get(incident.severity, _SEV_CONFIG[Severity.MEDIUM])
    badge = render_severity_badge(incident.severity)
    br = incident.blast_radius
    root_short = br.root_cause_table.rsplit(".", 1)[-1] if br else "—"
    blast_count = br.total_affected_assets if br else 0

    # Card header
    st.markdown(
        f"""
        <div style="background:linear-gradient(135deg, #0F172A 0%, #1E293B 100%);
                    border-radius:12px;padding:20px 24px;margin-bottom:8px;
                    border-left:4px solid {sev['color']};
                    border:1px solid #334155;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <span style="color:#94A3B8;font-size:12px;font-family:monospace;">
                        INC-{incident.id[:8].upper()}
                    </span>
                    {badge}
                </div>
                <span style="color:#64748B;font-size:12px;">
                    {incident.created_at.strftime('%Y-%m-%d %H:%M UTC')}
                </span>
            </div>
            <div style="color:#F1F5F9;font-size:18px;font-weight:600;margin-top:10px;">
                {incident.title}
            </div>
            <div style="display:flex;gap:24px;margin-top:12px;">
                <span style="color:#94A3B8;font-size:13px;">
                    🎯 Root: <strong style="color:#F97316;">{root_short}</strong>
                </span>
                <span style="color:#94A3B8;font-size:13px;">
                    💥 Blast radius: <strong style="color:#FBBF24;">{blast_count} assets</strong>
                </span>
                <span style="color:#94A3B8;font-size:13px;">
                    📋 Status: <strong style="color:#38BDF8;">{incident.status.value}</strong>
                </span>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    # Expandable details
    with st.expander(f"📄 View Full Report — INC-{incident.id[:8].upper()}", expanded=False):
        _render_report_details(incident)
        _render_failures_table(incident)


def _render_report_details(incident: Incident) -> None:
    """Render the AI-generated report inside an expander."""
    report = incident.report
    if not report:
        st.warning("Report not yet generated.")
        return

    st.markdown("#### 📝 Executive Summary")
    st.info(report.summary)

    col1, col2 = st.columns(2)
    with col1:
        st.markdown("#### 🔍 Root Cause Analysis")
        st.markdown(report.root_cause_analysis)

    with col2:
        st.markdown("#### 💥 Blast Radius")
        st.markdown(report.blast_radius_description)

    st.markdown("#### ⚖️ Severity Justification")
    st.markdown(report.severity_justification)

    if report.recommendations:
        st.markdown("#### ✅ Recommendations")
        for i, rec in enumerate(report.recommendations, 1):
            st.markdown(
                f"""<div style="background:#1E293B;border-radius:8px;padding:10px 16px;
                            margin-bottom:6px;border-left:3px solid #22C55E;
                            color:#E2E8F0;">
                    <strong style="color:#22C55E;">{i}.</strong> {rec}
                </div>""",
                unsafe_allow_html=True,
            )


def _render_failures_table(incident: Incident) -> None:
    """Render the raw test failures as a styled table."""
    if not incident.failures:
        return

    st.markdown("#### 🧪 Failed Test Cases")
    for f in incident.failures:
        table_short = f.table_fqn.rsplit(".", 1)[-1]
        st.markdown(
            f"""<div style="background:#1E293B;border-radius:8px;padding:12px 16px;
                        margin-bottom:6px;border:1px solid #334155;">
                <div style="color:#F97316;font-weight:600;">{f.test_case_name}</div>
                <div style="color:#94A3B8;font-size:13px;margin-top:4px;">
                    Table: <code>{table_short}</code> · Column: <code>{f.column or '—'}</code>
                    · Type: <code>{f.test_definition}</code>
                </div>
                <div style="color:#EF4444;font-size:13px;margin-top:6px;">
                    {f.result_message}
                </div>
            </div>""",
            unsafe_allow_html=True,
        )

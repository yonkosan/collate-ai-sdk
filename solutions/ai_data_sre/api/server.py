# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""DataPulse FastAPI backend — serves the React dashboard.

Endpoints:
  POST /api/pipeline/run        - Run the full incident pipeline
  GET  /api/incidents           - List all incidents
  GET  /api/incidents/{id}      - Get a single incident
  PUT  /api/incidents/{id}/ack  - Acknowledge an incident
  PUT  /api/incidents/{id}/assign - Assign an incident
  PUT  /api/incidents/{id}/resolve - Resolve an incident
  GET  /api/health              - Health check

Usage:
    cd solutions/ai_data_sre && uvicorn api.server:app --reload --port 8000
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from core.config import DataPulseConfig
from core.models import Incident, IncidentStatus
from core.slack_notifier import SlackNotifier

logger = logging.getLogger("datapulse.api")

app = FastAPI(
    title="DataPulse API",
    description="AI-Powered Data Incident Command Center",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://localhost:5173", "http://localhost:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory incident store (populated after pipeline run)
_incidents: Dict[str, Incident] = {}
_config: Optional[DataPulseConfig] = None
_slack: Optional[SlackNotifier] = None


def _get_config() -> DataPulseConfig:
    global _config
    if _config is None:
        _config = DataPulseConfig.from_env()
    return _config


def _get_slack() -> SlackNotifier:
    global _slack
    if _slack is None:
        _slack = SlackNotifier(_get_config())
    return _slack


# ─── Request/Response models ──────────────────────────────────────────────


class PipelineResponse(BaseModel):
    status: str
    incident_count: int
    incidents: List[dict]


class AckRequest(BaseModel):
    acknowledged_by: str = "admin"


class AssignRequest(BaseModel):
    assignee: str


class ResolveRequest(BaseModel):
    resolution_note: str
    resolved_by: str = "admin"


class IncidentSummary(BaseModel):
    id: str
    title: str
    severity: str
    status: str
    failure_count: int
    blast_radius_size: int
    root_cause_table: str
    assigned_to: Optional[str]
    acknowledged_by: Optional[str]
    resolved_by: Optional[str]
    slack_thread_url: Optional[str]
    created_at: str
    has_report: bool
    has_recurring_failures: bool


class UserInfo(BaseModel):
    name: str
    display_name: str


# ─── Helper functions ────────────────────────────────────────────────────


def _incident_to_summary(inc: Incident) -> IncidentSummary:
    br = inc.blast_radius
    return IncidentSummary(
        id=inc.id,
        title=inc.title,
        severity=inc.severity.name,
        status=inc.status.value,
        failure_count=len(inc.failures),
        blast_radius_size=br.total_affected_assets if br else 0,
        root_cause_table=br.root_cause_table if br else "Unknown",
        assigned_to=inc.assigned_to,
        acknowledged_by=inc.acknowledged_by,
        resolved_by=inc.resolved_by,
        slack_thread_url=inc.slack_thread_url,
        created_at=inc.created_at.isoformat(),
        has_report=inc.report is not None,
        has_recurring_failures=any(h.is_recurring for h in inc.failure_histories),
    )


# ─── API endpoints ───────────────────────────────────────────────────────


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "datapulse"}


@app.post("/api/pipeline/run", response_model=PipelineResponse)
def run_pipeline():
    """Run the full Sentinel → Investigator → Narrator pipeline."""
    from core.orchestrator import Orchestrator

    config = _get_config()
    orch = Orchestrator(config)
    try:
        incidents = orch.run_pipeline()
        _incidents.clear()
        for inc in incidents:
            _incidents[inc.id] = inc

        return PipelineResponse(
            status="completed",
            incident_count=len(incidents),
            incidents=[_incident_to_summary(inc).model_dump() for inc in incidents],
        )
    finally:
        orch.close()


@app.get("/api/incidents", response_model=List[IncidentSummary])
def list_incidents():
    """List all incidents from the last pipeline run."""
    return [_incident_to_summary(inc) for inc in _incidents.values()]


@app.get("/api/incidents/{incident_id}")
def get_incident(incident_id: str):
    """Get full incident details including report and blast radius."""
    inc = _incidents.get(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")
    data = inc.model_dump()
    # Normalize severity to string name for frontend consistency
    data["severity"] = inc.severity.name
    return data


@app.put("/api/incidents/{incident_id}/ack")
def acknowledge_incident(incident_id: str, body: AckRequest):
    """Acknowledge an incident."""
    inc = _incidents.get(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")

    inc.transition(IncidentStatus.ACKNOWLEDGED)
    inc.acknowledged_at = datetime.now(timezone.utc)
    inc.acknowledged_by = body.acknowledged_by

    # Slack update
    slack = _get_slack()
    slack.post_acknowledged(inc, body.acknowledged_by)

    # OM hybrid — update test case incident status
    _push_om_incident_status(inc, "Ack")

    return {
        "status": "acknowledged",
        "incident_id": incident_id,
        "acknowledged_by": body.acknowledged_by,
    }


@app.put("/api/incidents/{incident_id}/assign")
def assign_incident(incident_id: str, body: AssignRequest):
    """Assign an incident to a user/team."""
    inc = _incidents.get(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")

    inc.assigned_to = body.assignee
    inc.updated_at = datetime.now(timezone.utc)

    # Slack update
    slack = _get_slack()
    slack.post_assigned(inc, body.assignee)

    # OM hybrid — update test case incident status
    _push_om_incident_status(inc, "Assigned")

    return {
        "status": "assigned",
        "incident_id": incident_id,
        "assignee": body.assignee,
    }


@app.put("/api/incidents/{incident_id}/resolve")
def resolve_incident(incident_id: str, body: ResolveRequest):
    """Resolve an incident with a resolution note."""
    inc = _incidents.get(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")

    inc.transition(IncidentStatus.RESOLVED)
    inc.resolution_note = body.resolution_note
    inc.resolved_by = body.resolved_by
    inc.resolved_at = datetime.now(timezone.utc)

    # Slack update
    slack = _get_slack()
    slack.post_resolved(inc, body.resolved_by, body.resolution_note)

    # OM hybrid — update test case incident status
    _push_om_incident_status(inc, "Resolved")

    return {
        "status": "resolved",
        "incident_id": incident_id,
        "resolved_by": body.resolved_by,
        "resolution_note": body.resolution_note,
    }


@app.get("/api/users", response_model=List[UserInfo])
def list_users(q: str = ""):
    """Proxy to OpenMetadata to list/search users for assignment."""
    config = _get_config()
    try:
        with httpx.Client(
            base_url=config.openmetadata_host,
            headers=config.api_headers,
            timeout=10.0,
        ) as client:
            params: dict = {"limit": 50}
            if q:
                params["name"] = f"*{q}*"
            resp = client.get("/api/v1/users", params=params)
            resp.raise_for_status()
            data = resp.json()
            users = []
            for u in data.get("data", []):
                users.append(
                    UserInfo(
                        name=u.get("name", ""),
                        display_name=u.get("displayName", u.get("name", "")),
                    )
                )
            return users
    except Exception as exc:
        logger.warning("Failed to fetch OM users: %s", exc)
        return [UserInfo(name="admin", display_name="Admin")]


@app.get("/api/teams", response_model=List[UserInfo])
def list_teams():
    """Proxy to OpenMetadata to list teams for assignment."""
    config = _get_config()
    try:
        with httpx.Client(
            base_url=config.openmetadata_host,
            headers=config.api_headers,
            timeout=10.0,
        ) as client:
            resp = client.get("/api/v1/teams", params={"limit": 50})
            resp.raise_for_status()
            data = resp.json()
            teams = []
            for t in data.get("data", []):
                teams.append(
                    UserInfo(
                        name=t.get("name", ""),
                        display_name=t.get("displayName", t.get("name", "")),
                    )
                )
            return teams
    except Exception as exc:
        logger.warning("Failed to fetch OM teams: %s", exc)
        return []


@app.get("/api/om/link/{entity_type}/{fqn:path}")
def get_om_link(entity_type: str, fqn: str):
    """Generate a deep link into the OpenMetadata UI for an entity."""
    config = _get_config()
    base = config.openmetadata_host.rstrip("/")
    link = f"{base}/{entity_type}/{fqn}"
    return {"link": link, "entity_type": entity_type, "fqn": fqn}


@app.get("/api/config")
def get_app_config():
    """Return frontend configuration."""
    config = _get_config()
    return {"om_base_url": config.openmetadata_host}


# ─── OM Hybrid helpers ──────────────────────────────────────────────────


def _push_om_incident_status(inc: Incident, status_label: str) -> None:
    """Best-effort push of incident status to OM testCaseIncidentStatus API."""
    config = _get_config()
    if not inc.failures:
        return
    try:
        with httpx.Client(
            base_url=config.openmetadata_host,
            headers=config.api_headers,
            timeout=10.0,
        ) as client:
            test_id = inc.failures[0].test_case_id
            resp = client.get(
                f"/api/v1/dataQuality/testCases/{test_id}",
                params={"fields": "incidentId"},
            )
            if resp.status_code == 200:
                tc_data = resp.json()
                incident_id = tc_data.get("incidentId")
                if incident_id:
                    client.put(
                        f"/api/v1/dataQuality/testCases/testCaseIncidentStatus/{incident_id}",
                        json={
                            "testCaseResolutionStatusType": status_label,
                            "testCaseResolutionStatusDetails": {
                                "resolvedBy": {"name": "admin", "type": "user"},
                            },
                        },
                    )
                    logger.info("Pushed OM incident status '%s' for test %s", status_label, test_id)
    except Exception as exc:
        logger.warning("Failed to push OM incident status: %s", exc)


# ─── Serve React frontend (production build) ─────────────────────────────

_DIST_DIR = Path(__file__).resolve().parent.parent / "web" / "dist"

if _DIST_DIR.is_dir():
    # Serve static assets (JS, CSS, images)
    app.mount("/assets", StaticFiles(directory=_DIST_DIR / "assets"), name="static-assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve React SPA — any non-API route returns index.html."""
        file_path = _DIST_DIR / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(_DIST_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("api.server:app", host="0.0.0.0", port=port, reload=True)

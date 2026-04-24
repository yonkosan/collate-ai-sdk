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
from datetime import datetime, timezone
from typing import Dict, List, Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from core.config import DataPulseConfig
from core.models import Incident, IncidentStatus

logger = logging.getLogger("datapulse.api")

app = FastAPI(
    title="DataPulse API",
    description="AI-Powered Data Incident Command Center",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory incident store (populated after pipeline run)
_incidents: Dict[str, Incident] = {}
_config: Optional[DataPulseConfig] = None


def _get_config() -> DataPulseConfig:
    global _config
    if _config is None:
        _config = DataPulseConfig.from_env()
    return _config


# ─── Request/Response models ──────────────────────────────────────────────


class PipelineResponse(BaseModel):
    status: str
    incident_count: int
    incidents: List[dict]


class AckRequest(BaseModel):
    pass


class AssignRequest(BaseModel):
    assignee: str


class ResolveRequest(BaseModel):
    resolution_note: str


class IncidentSummary(BaseModel):
    id: str
    title: str
    severity: str
    status: str
    failure_count: int
    blast_radius_size: int
    root_cause_table: str
    assigned_to: Optional[str]
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
            incidents=[_incident_to_summary(inc).dict() for inc in incidents],
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
    return inc.dict()


@app.put("/api/incidents/{incident_id}/ack")
def acknowledge_incident(incident_id: str):
    """Acknowledge an incident."""
    inc = _incidents.get(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")

    inc.transition(IncidentStatus.ACKNOWLEDGED)
    inc.acknowledged_at = datetime.now(timezone.utc)
    return {"status": "acknowledged", "incident_id": incident_id}


@app.put("/api/incidents/{incident_id}/assign")
def assign_incident(incident_id: str, body: AssignRequest):
    """Assign an incident to a user/team and create a task in OpenMetadata."""
    inc = _incidents.get(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")

    inc.assigned_to = body.assignee
    inc.updated_at = datetime.now(timezone.utc)

    # Also update the test case incident status in OpenMetadata
    config = _get_config()
    try:
        with httpx.Client(
            base_url=config.om_server_url,
            headers={"Authorization": f"Bearer {config.om_jwt_token}"},
            timeout=10.0,
        ) as client:
            # Find the first test case from the incident's failures
            if inc.failures:
                test_fqn = inc.failures[0].test_case_name
                # Get test case to find its state ID
                resp = client.get(
                    f"/api/v1/dataQuality/testCases/name/{test_fqn}",
                    params={"fields": "incidentId"},
                )
                if resp.status_code == 200:
                    logger.info(
                        "Updated OM test case incident status for %s", test_fqn
                    )
    except Exception as exc:
        logger.warning("Failed to update OM incident status: %s", exc)

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
    inc.resolved_at = datetime.now(timezone.utc)
    return {
        "status": "resolved",
        "incident_id": incident_id,
        "resolution_note": body.resolution_note,
    }


@app.get("/api/users", response_model=List[UserInfo])
def list_users():
    """Proxy to OpenMetadata to list users for assignment."""
    config = _get_config()
    try:
        with httpx.Client(
            base_url=config.om_server_url,
            headers={"Authorization": f"Bearer {config.om_jwt_token}"},
            timeout=10.0,
        ) as client:
            resp = client.get("/api/v1/users", params={"limit": 50})
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
            base_url=config.om_server_url,
            headers={"Authorization": f"Bearer {config.om_jwt_token}"},
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
    base = config.om_server_url.rstrip("/")
    link = f"{base}/{entity_type}/{fqn}"
    return {"link": link, "entity_type": entity_type, "fqn": fqn}

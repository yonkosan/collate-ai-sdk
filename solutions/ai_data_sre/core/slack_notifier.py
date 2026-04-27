# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""Slack integration — posts incident threads and updates to a Slack channel.

Each incident gets its own thread. Every lifecycle action (assign, ack, resolve)
posts a reply to that thread, creating a full audit trail.
"""

from __future__ import annotations

import logging
from typing import Optional

import httpx

from core.config import DataPulseConfig
from core.models import Incident, ResolutionVerification

logger = logging.getLogger("datapulse.slack")

SLACK_POST_URL = "https://slack.com/api/chat.postMessage"

SEVERITY_EMOJI = {
    "CRITICAL": "🔴",
    "HIGH": "🟠",
    "MEDIUM": "🟡",
    "LOW": "🟢",
    "INFO": "⚪",
}


class SlackNotifier:
    """Posts incident lifecycle events to a Slack channel."""

    def __init__(self, config: DataPulseConfig) -> None:
        self._token = config.slack_bot_token
        self._channel = config.slack_channel_id
        self._enabled = bool(self._token and self._channel)
        self._om_host = config.openmetadata_host
        if not self._enabled:
            logger.info("Slack integration disabled (no token or channel)")

    @property
    def enabled(self) -> bool:
        return self._enabled

    def post_new_incident(self, incident: Incident) -> Optional[str]:
        """Post the initial incident message and return the thread_ts."""
        if not self._enabled:
            return None

        sev = incident.severity.name
        emoji = SEVERITY_EMOJI.get(sev, "⚪")
        br = incident.blast_radius
        root = br.root_cause_table.rsplit(".", 1)[-1] if br else "Unknown"
        blast_count = br.total_affected_assets if br else 0

        failures_text = "\n".join(
            f"  • `{f.test_case_name}` on `{f.table_fqn.rsplit('.', 1)[-1]}`"
            + (f" (column: `{f.column}`)" if f.column else "")
            for f in incident.failures
        )

        om_link = f"{self._om_host}/table/{br.root_cause_table}" if br else ""

        blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": f"{emoji} {sev} — {incident.title}",
                    "emoji": True,
                },
            },
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*Incident ID:*\n`{incident.id}`"},
                    {"type": "mrkdwn", "text": f"*Severity:*\n{emoji} {sev}"},
                    {"type": "mrkdwn", "text": f"*Root Cause:*\n`{root}`"},
                    {"type": "mrkdwn", "text": f"*Blast Radius:*\n{blast_count} assets"},
                ],
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Failed Tests:*\n{failures_text}",
                },
            },
        ]

        if om_link:
            blocks.append({
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "🔗 Open in OpenMetadata"},
                        "url": om_link,
                        "action_id": "open_om",
                    }
                ],
            })

        blocks.append({
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": "⏳ *Status:* Awaiting assignment | Reply in this thread for updates",
                }
            ],
        })

        thread_ts = self._post_message(
            text=f"{emoji} {sev}: {incident.title}",
            blocks=blocks,
        )
        return thread_ts

    def post_ai_report(self, incident: Incident) -> None:
        """Post the AI-generated report as a thread reply."""
        if not self._enabled or not incident.slack_thread_ts or not incident.report:
            return

        report = incident.report
        recs = "\n".join(f"  {i+1}. {r}" for i, r in enumerate(report.recommendations))

        text = (
            f"🤖 *AI Incident Report*\n\n"
            f"*Summary:* {report.summary}\n\n"
            f"*Root Cause Analysis:* {report.root_cause_analysis}\n\n"
            f"*Blast Radius:* {report.blast_radius_description}\n\n"
        )
        if report.stakeholders_affected:
            text += f"*Stakeholders:* {report.stakeholders_affected}\n\n"
        if report.trend_analysis:
            text += f"*Trend:* {report.trend_analysis}\n\n"
        text += f"*Recommendations:*\n{recs}"

        self._post_reply(incident.slack_thread_ts, text)

    def post_assigned(self, incident: Incident, assignee: str) -> None:
        """Post an assignment update to the thread."""
        if not self._enabled or not incident.slack_thread_ts:
            return
        self._post_reply(
            incident.slack_thread_ts,
            f"👤 *Assigned to {assignee}*\nPlease acknowledge this incident.",
        )

    def post_acknowledged(self, incident: Incident, by: str) -> None:
        """Post an acknowledgment update to the thread."""
        if not self._enabled or not incident.slack_thread_ts:
            return
        self._post_reply(
            incident.slack_thread_ts,
            f"✅ *Acknowledged by {by}*\nInvestigation in progress.",
        )

    def post_resolved(self, incident: Incident, by: str, note: str) -> None:
        """Post a resolution update to the thread."""
        if not self._enabled or not incident.slack_thread_ts:
            return
        self._post_reply(
            incident.slack_thread_ts,
            f"🎉 *Resolved by {by}*\n_{note}_",
        )

    def post_reassigned(self, incident: Incident, from_user: str, to_user: str) -> None:
        """Post a re-assignment update to the thread."""
        if not self._enabled or not incident.slack_thread_ts:
            return
        self._post_reply(
            incident.slack_thread_ts,
            f"🔄 *Re-assigned from {from_user} → {to_user}*",
        )

    def post_verification_passed(self, incident: Incident) -> None:
        """Post verification success to the thread."""
        if not self._enabled or not incident.slack_thread_ts:
            return
        vr = incident.verification_result or {}
        text = "✅ *DQ Verification Passed* — All tests now passing."
        confidence = vr.get("confidence", "")
        if confidence:
            text += f"\n\n📝 *Note Alignment:* {confidence}"
            reason = vr.get("confidence_reason", "")
            if reason:
                text += f"\n_{reason}_"
        self._post_reply(incident.slack_thread_ts, text)

    def post_verification_failed(self, incident: Incident, message: str) -> None:
        """Post verification failure to the thread."""
        if not self._enabled or not incident.slack_thread_ts:
            return
        self._post_reply(
            incident.slack_thread_ts,
            f"❌ *Resolution Rejected — DQ Check Still Failing*\n{message}",
        )

    def post_resolution_summary(self, incident: Incident) -> None:
        """Post a final resolution summary card to the thread."""
        if not self._enabled or not incident.slack_thread_ts:
            return

        created = incident.created_at
        resolved = incident.resolved_at
        if created and resolved:
            delta = resolved - created
            hours = int(delta.total_seconds() // 3600)
            mins = int((delta.total_seconds() % 3600) // 60)
            ttr = f"{hours}h {mins}m" if hours > 0 else f"{mins}m"
        else:
            ttr = "N/A"

        actors = []
        if incident.acknowledged_by:
            actors.append(f"Acknowledged by {incident.acknowledged_by}")
        if incident.assigned_to:
            actors.append(f"Assigned to {incident.assigned_to}")
        if incident.resolved_by:
            actors.append(f"Resolved by {incident.resolved_by}")

        vr = incident.verification_result or {}
        verify_line = "✅ Verified" if vr.get("verified") else "⚠️ Not verified"

        text = (
            "📋 *Resolution Summary*\n"
            f"• *Time to Resolution:* {ttr}\n"
            f"• *Actors:* {' → '.join(actors) if actors else 'N/A'}\n"
            f"• *Verification:* {verify_line}\n"
            f"• *Category:* {incident.resolution_category or 'Not specified'}\n"
            f"• *Note:* _{incident.resolution_note or 'None'}_"
        )
        self._post_reply(incident.slack_thread_ts, text)

    def post_reassigned(self, incident: Incident, previous: str, new: str) -> None:
        """Post a re-assignment update to the thread."""
        if not self._enabled or not incident.slack_thread_ts:
            return
        self._post_reply(
            incident.slack_thread_ts,
            f"🔄 *Re-assigned from {previous} → {new}*",
        )

    def post_verification_result(
        self, incident: Incident, result: ResolutionVerification
    ) -> None:
        """Post the DQ verification result to the thread."""
        if not self._enabled or not incident.slack_thread_ts:
            return

        if result.verified:
            confidence_text = f" Confidence: *{result.confidence}*" if result.confidence else ""
            reason = f"\n_{result.confidence_reason}_" if result.confidence_reason else ""
            text = f"✅ *Resolution verified* — all DQ checks now passing.{confidence_text}{reason}"
        else:
            failing = ", ".join(f"`{t}`" for t in result.still_failing_tests)
            text = (
                f"❌ *Resolution rejected* — DQ checks still failing.\n"
                f"Failing tests: {failing}\n"
                f"Latest error: _{result.latest_error}_"
            )

        self._post_reply(incident.slack_thread_ts, text)

    def post_thread_message(self, incident: Incident, text: str) -> None:
        """Post an arbitrary message to an incident's Slack thread."""
        if not self._enabled or not incident.slack_thread_ts:
            return
        self._post_reply(incident.slack_thread_ts, text)

    def _post_message(self, text: str, blocks: list) -> Optional[str]:
        """Post a top-level message and return thread_ts."""
        try:
            resp = httpx.post(
                SLACK_POST_URL,
                headers={"Authorization": f"Bearer {self._token}"},
                json={
                    "channel": self._channel,
                    "text": text,
                    "blocks": blocks,
                },
                timeout=10.0,
            )
            data = resp.json()
            if data.get("ok"):
                ts = data.get("ts", "")
                logger.info("Slack message posted: %s", ts)
                return ts
            logger.warning("Slack API error: %s", data.get("error"))
            return None
        except Exception as exc:
            logger.warning("Slack post failed: %s", exc)
            return None

    def _post_reply(self, thread_ts: str, text: str) -> None:
        """Post a reply in a thread."""
        try:
            resp = httpx.post(
                SLACK_POST_URL,
                headers={"Authorization": f"Bearer {self._token}"},
                json={
                    "channel": self._channel,
                    "text": text,
                    "thread_ts": thread_ts,
                },
                timeout=10.0,
            )
            data = resp.json()
            if not data.get("ok"):
                logger.warning("Slack reply failed: %s", data.get("error"))
        except Exception as exc:
            logger.warning("Slack reply failed: %s", exc)

    def build_thread_url(self, thread_ts: str) -> str:
        """Build a Slack deep link to the thread."""
        ts_no_dot = thread_ts.replace(".", "")
        return f"https://slack.com/archives/{self._channel}/p{ts_no_dot}"

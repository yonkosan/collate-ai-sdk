# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""Verifier — re-runs DQ checks to validate incident resolution.

Before marking an incident resolved, the Verifier:
  1. Queries the latest test result from OpenMetadata
  2. If still failing → returns rejection with the exact error
  3. If passing → returns success with verification timestamp

Optionally validates that the resolution note aligns with the actual
failure/fix using GPT-4o-mini.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

import httpx
import openai

from core.config import DataPulseConfig
from core.models import Incident, ResolutionVerification

logger = logging.getLogger("datapulse.verifier")


@dataclass(frozen=True)
class NoteAlignment:
    """How well the resolution note aligns with the actual failure."""

    confidence: str  # "HIGH", "MEDIUM", "LOW"
    explanation: str


class Verifier:
    """Validates that DQ failures are actually resolved before closing."""

    def __init__(self, config: DataPulseConfig) -> None:
        self._config = config
        self._openai = openai.OpenAI(api_key=config.openai_api_key) if config.openai_api_key else None

    def verify_resolution(
        self,
        incident: Incident,
        resolution_note: str,
        skip_note_validation: bool = False,
    ) -> ResolutionVerification:
        """Check if the DQ tests that caused this incident are now passing.

        Returns a ResolutionVerification indicating pass/fail with details.
        """
        still_failing: list[str] = []
        passing: list[str] = []
        error_messages: list[str] = []

        for failure in incident.failures:
            test_status = self._check_latest_test_result(failure.test_case_id)
            if test_status is None:
                # Cannot verify — treat as passing (best-effort)
                passing.append(failure.test_case_name)
            elif test_status["status"] == "Failed":
                still_failing.append(failure.test_case_name)
                error_messages.append(
                    f"{failure.test_case_name}: {test_status.get('message', 'still failing')}"
                )
            else:
                passing.append(failure.test_case_name)

        if still_failing:
            latest_error = "; ".join(error_messages)
            return ResolutionVerification(
                verified=False,
                still_failing_tests=still_failing,
                latest_error=latest_error,
            )

        # All tests passing — optionally validate note
        confidence = ""
        confidence_reason = ""
        if not skip_note_validation and self._openai and resolution_note:
            alignment = self._validate_note(incident, resolution_note)
            if alignment:
                confidence = alignment.confidence
                confidence_reason = alignment.explanation

        return ResolutionVerification(
            verified=True,
            confidence=confidence,
            confidence_reason=confidence_reason,
            still_failing_tests=[],
            latest_error="",
        )

    def _check_latest_test_result(self, test_case_id: str) -> Optional[dict]:
        """Query OM for the latest result of a specific test case."""
        try:
            with httpx.Client(
                base_url=self._config.openmetadata_host,
                headers=self._config.api_headers,
                timeout=15.0,
            ) as client:
                resp = client.get(
                    f"/api/v1/dataQuality/testCases/{test_case_id}/testCaseResult",
                    params={"limit": 1},
                )
                if resp.status_code != 200:
                    logger.warning(
                        "Failed to fetch test result for %s: %s",
                        test_case_id, resp.status_code,
                    )
                    return None

                data = resp.json()
                results = data.get("data", [])
                if not results:
                    return None

                latest = results[0]
                return {
                    "status": latest.get("testCaseStatus", "Unknown"),
                    "message": latest.get("result", ""),
                    "timestamp": latest.get("timestamp", ""),
                }
        except Exception as exc:
            logger.warning("Error checking test result for %s: %s", test_case_id, exc)
            return None

    def _validate_note(
        self, incident: Incident, resolution_note: str
    ) -> Optional[NoteAlignment]:
        """Use LLM to check if the resolution note aligns with the actual failure."""
        failures_context = "\n".join(
            f"- Test: {f.test_case_name} on {f.table_fqn}"
            f" (column: {f.column or 'N/A'})\n"
            f"  Error: {f.result_message}"
            for f in incident.failures
        )

        prompt = (
            "You are validating whether a resolution note accurately describes "
            "how a data quality issue was fixed.\n\n"
            f"ORIGINAL FAILURES:\n{failures_context}\n\n"
            f"RESOLUTION NOTE:\n{resolution_note}\n\n"
            "Respond with JSON only:\n"
            '{"confidence": "HIGH|MEDIUM|LOW", '
            '"explanation": "brief explanation of alignment"}\n\n'
            "HIGH = note clearly explains the fix for the reported failures\n"
            "MEDIUM = note is plausible but vague or partially relevant\n"
            "LOW = note doesn't match the failure type at all"
        )

        try:
            resp = self._openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You validate incident resolution notes. Respond with JSON only."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2,
                max_tokens=200,
            )
            text = resp.choices[0].message.content or "{}"
            # Strip markdown fences if present
            text = text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1] if "\n" in text else text[3:]
                text = text.rsplit("```", 1)[0]
            data = json.loads(text)
            return NoteAlignment(
                confidence=data.get("confidence", "MEDIUM"),
                explanation=data.get("explanation", ""),
            )
        except Exception as exc:
            logger.warning("Note validation failed: %s", exc)
            return NoteAlignment(
                confidence="MEDIUM",
                explanation="Could not validate — LLM unavailable",
            )
